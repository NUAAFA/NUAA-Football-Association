#!/usr/bin/env python3
"""Candidate sidecar: aggregate-only log observation and durable notification outbox.

No application imports, production defaults, database access, installation or sender
activation. Transport acceptance is NOT proof of human receipt. See README.md.
"""
import argparse
import contextlib
import datetime as dt
import email.message
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import selectors
import smtplib
import sqlite3
import ssl
import stat
import subprocess
import sys
import time

MAX_READ = 1024 * 1024
MAX_LINE = 65536
MONITOR_SOURCE_MAX_AGE_SECONDS = 900  # candidate policy; installation approval required
CHECKS = frozenset([
    'PUBLIC_HTTPS_HOME', 'PUBLIC_HTTPS_HEALTH', 'LOCAL_APPLICATION_HEALTH',
    'APPLICATION', 'APPLICATION_RESTARTS', 'VERSION', 'NGINX', 'NGINX_CONFIG',
    'NGINX_ERROR_LOG', 'SQLITE', 'DISK_INODES', 'MEMORY', 'CPU',
    'HTTPS_CERTIFICATE', 'CERTIFICATE_RENEWAL', 'BACKUP_FRESHNESS_AND_FAILURE',
    'BACKUP_COMPLETION', 'ISOLATED_RESTORE_FRESHNESS',
    *('SCHEDULE_nuaafa-ops-' + v + '.timer' for v in ['backup', 'monitor', 'restore', 'nginx-log']),
    'HTTP_5XX_WINDOW', 'APPLICATION_DATABASE_ERRORS', 'LOG_COLLECTOR_HEALTH','COLLECTOR_INPUT_FRESHNESS',
])
KINDS = {'INCIDENT_OPEN', 'INCIDENT_RECOVERY'}
STATES = {'PENDING', 'RETRY', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN_DELIVERY'}


class SafeError(Exception):
    """Only static codes, never underlying exception messages, leave this module."""


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def no_links(path):
    path = Path(path).absolute()
    if any(p.is_symlink() for p in [path, *path.parents]):
        raise SafeError('PATH_LINK_REJECTED')
    return path


def read_file(path, limit=MAX_READ, private=False):
    path = no_links(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
            raise SafeError('INPUT_TYPE_REJECTED')
        if private and (st.st_uid not in {0, os.getuid()} or stat.S_IMODE(st.st_mode) & 0o077):
            raise SafeError('PRIVATE_FILE_PERMISSION')
        data = os.read(fd, limit + 1)
        if len(data) > limit:
            raise SafeError('INPUT_SIZE_LIMIT')
        return data
    finally:
        os.close(fd)


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise SafeError('EVENT_NUMBER_INVALID')
    return value


def normalize_event(value):
    """Whitelist exact known check names; never retain arbitrary message/URL/error."""
    if not isinstance(value, dict) or value.get('kind') not in KINDS or value.get('check') not in CHECKS:
        return None
    since = number(value.get('since_epoch'))
    epoch_key = 'detected_epoch' if value['kind'] == 'INCIDENT_OPEN' else 'recovered_epoch'
    epoch = number(value.get(epoch_key))
    if epoch < since:
        raise SafeError('EVENT_TIME_ORDER')
    incident = hashlib.sha256(canonical([value['check'], float(since)]).encode()).hexdigest()
    payload = {'kind': value['kind'], 'check': value['check'], 'since_epoch': since, epoch_key: epoch}
    event_id = hashlib.sha256(canonical([incident, value['kind']]).encode()).hexdigest()
    return event_id, incident, payload


def advance(previous, checks, epoch):
    """Same 3-fail / 2-recovery semantics as installed monitor; new checks only."""
    state, events = {}, []
    for check, ok in checks.items():
        if check not in CHECKS or type(ok) is not bool:
            raise SafeError('CHECK_INVALID')
        old = previous.get(check, {})
        bad = 0 if ok else old.get('failures', 0) + 1
        good = old.get('successes', 0) + 1 if ok else 0
        alerted = old.get('alerted', False)
        since = old.get('since', epoch)
        if not ok and old.get('failures', 0) == 0 and not alerted:
            since = epoch
        if bad >= 3 and not alerted:
            events.append(dict(kind='INCIDENT_OPEN', check=check, since_epoch=since, detected_epoch=epoch))
            alerted = True
        if good >= 2 and alerted:
            events.append(dict(kind='INCIDENT_RECOVERY', check=check, since_epoch=since, recovered_epoch=epoch))
            alerted = False
        state[check] = dict(failures=bad, successes=good, alerted=alerted, since=since)
    return state, events


class Outbox:
    """One process, one private state directory. SENDING crash => no blind resend."""
    def __init__(self, directory):
        self.root = no_links(directory)
        st = self.root.stat()
        if not self.root.is_dir() or st.st_uid != os.getuid() or stat.S_IMODE(st.st_mode) != 0o700:
            raise SafeError('STATE_DIRECTORY_PERMISSION')
        self.lock = os.open(self.root / '.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            lockstat = os.fstat(self.lock)
            if lockstat.st_uid != os.getuid() or lockstat.st_nlink != 1 or stat.S_IMODE(lockstat.st_mode) != 0o600:
                raise SafeError('STATE_LOCK_PERMISSION')
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            dbpath = self.root / 'outbox.sqlite'
            if dbpath.exists() or dbpath.is_symlink():
                st = dbpath.lstat()
                if dbpath.is_symlink() or st.st_nlink != 1 or not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid() or stat.S_IMODE(st.st_mode) != 0o600:
                    raise SafeError('STATE_DATABASE_PERMISSION')
            fd = os.open(dbpath, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            os.close(fd)
            self.db = sqlite3.connect(dbpath)
            self.db.row_factory = sqlite3.Row
            self.db.execute('PRAGMA journal_mode=DELETE')
            self.db.executescript('''CREATE TABLE IF NOT EXISTS events (
              id TEXT PRIMARY KEY, incident TEXT NOT NULL, kind TEXT NOT NULL,
              payload TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL,
              due REAL NOT NULL, code TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);''')
            self.db.execute("UPDATE events SET status='UNKNOWN_DELIVERY',code='PROCESS_INTERRUPTED_DURING_SEND' WHERE status='SENDING'")
            self.db.commit()
        except BaseException:
            os.close(self.lock)
            raise

    def close(self):
        self.db.close()
        os.close(self.lock)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def metadata(self, key, default=None):
        row = self.db.execute('SELECT value FROM metadata WHERE key=?', (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def put_metadata(self, key, value):
        self.db.execute('INSERT OR REPLACE INTO metadata VALUES (?,?)', (key, canonical(value)))

    def enqueue(self, value):
        normalized = normalize_event(value)
        if normalized is None:
            return False
        event_id, incident, payload = normalized
        cursor = self.db.execute('INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?,?,?)',
                                 (event_id, incident, payload['kind'], canonical(payload), 'PENDING', 0, 0, 'QUEUED'))
        return cursor.rowcount == 1

    def ingest(self, filename, *, from_start=False):
        """Original event log is read only; offset and inserted events commit together."""
        key = 'events-cursor-' + hashlib.sha256(str(Path(filename).absolute()).encode()).hexdigest()
        cursor = self.metadata(key)
        records, new_cursor = tail_lines(filename, cursor, initial_skip=not from_start)
        count, ignored = 0, 0
        with self.db:
            for raw in records:
                try:
                    value = json.loads(raw)
                    count += self.enqueue(value)
                except (ValueError, SafeError):
                    ignored += 1
            self.put_metadata(key, new_cursor)
        return {'inserted': count, 'invalid': ignored, 'backlog_bytes': new_cursor['backlog_bytes']}

    def bootstrap_current(self, latest_file, epoch):
        """Explicit approval-time bootstrap: current active incidents, no old spam."""
        latest = json.loads(read_file(latest_file))
        if not isinstance(latest, dict) or not isinstance(latest.get('state'), dict):
            raise SafeError('MONITOR_SNAPSHOT_INVALID')
        inserted = 0
        with self.db:
            for check, state in latest['state'].items():
                if check in CHECKS and state.get('alerted') is True:
                    inserted += self.enqueue(dict(kind='INCIDENT_OPEN', check=check,
                                                  since_epoch=state.get('since'), detected_epoch=epoch))
        return {'active_incidents_inserted': inserted}

    def dispatch(self, transport, epoch, max_attempts=4, retry_seconds=(30, 120, 600), max_batch=1):
        if not 1 <= max_attempts <= 10 or len(retry_seconds) < max_attempts - 1 or any(not 1 <= x <= 86400 for x in retry_seconds):
            raise SafeError('RETRY_POLICY_INVALID')
        counts = {'sent': 0, 'retry': 0, 'failed': 0, 'unknown': 0, 'blocked': 0}
        counts['blocked'] = self.db.execute("SELECT count(*) FROM events e WHERE e.status IN ('PENDING','RETRY') AND e.kind='INCIDENT_RECOVERY' AND NOT EXISTS (SELECT 1 FROM events p WHERE p.incident=e.incident AND p.kind='INCIDENT_OPEN' AND p.status='SENT')").fetchone()[0]
        for _ in range(min(max_batch, 100)):
            row = self.db.execute("SELECT * FROM events e WHERE status IN ('PENDING','RETRY') AND due<=? AND (kind='INCIDENT_OPEN' OR EXISTS (SELECT 1 FROM events p WHERE p.incident=e.incident AND p.kind='INCIDENT_OPEN' AND p.status='SENT')) ORDER BY json_extract(payload,'$.since_epoch'), CASE kind WHEN 'INCIDENT_OPEN' THEN 0 ELSE 1 END LIMIT 1", (epoch,)).fetchone()
            if row is None:
                break
            attempt = row['attempts'] + 1
            with self.db:
                self.db.execute("UPDATE events SET status='SENDING',attempts=?,code='SEND_STARTED' WHERE id=?", (attempt, row['id']))
            try:
                transport.send(row['id'], json.loads(row['payload']))
                status, code, due, count = 'SENT', 'TRANSPORT_ACCEPTED_NOT_RECEIPT', epoch, 'sent'
            except RetryableTransport:
                if attempt >= max_attempts:
                    status, code, due, count = 'FAILED', 'RETRIES_EXHAUSTED', epoch, 'failed'
                else:
                    status, code, due, count = 'RETRY', 'PRE_ACCEPTANCE_RETRY', epoch + retry_seconds[attempt - 1], 'retry'
            except Exception:
                # DATA timeout/disconnect or unknown adapter errors can follow acceptance.
                status, code, due, count = 'UNKNOWN_DELIVERY', 'ACCEPTANCE_UNCERTAIN_REVIEW_REQUIRED', epoch, 'unknown'
            with self.db:
                self.db.execute('UPDATE events SET status=?,code=?,due=? WHERE id=?', (status, code, due, row['id']))
            counts[count] += 1
        return counts

    def summary(self):
        return {r[0]: r[1] for r in self.db.execute('SELECT status,count(*) FROM events GROUP BY status')}

    def health(self, epoch, max_pending_age=3600):
        summary = self.summary()
        stale = self.db.execute("SELECT count(*) FROM events WHERE status IN ('PENDING','RETRY') AND COALESCE(json_extract(payload,'$.detected_epoch'),json_extract(payload,'$.recovered_epoch'))<?", (epoch - max_pending_age,)).fetchone()[0]
        source=self.metadata('sender-collector-health',{}).get('COLLECTOR_INPUT_FRESHNESS',{})
        source_bad=bool(source.get('failures',0) or source.get('alerted',False))
        return {'ok': not (summary.get('FAILED', 0) or summary.get('UNKNOWN_DELIVERY', 0) or stale or source_bad),
                'states': summary, 'stale_pending': stale,'collector_input_degraded':source_bad, 'receipt_proven': False}


class RetryableTransport(Exception):
    """Only use when peer is known NOT to have accepted the message."""


class SMTPTransport:
    def __init__(self, config_file, *, ssl_context=None):
        config = json.loads(read_file(config_file, 16384, private=True))
        if config.get('enabled') is not True or config.get('transport') != 'smtp_tls':
            raise SafeError('TRANSPORT_DISABLED')
        allowed = {'enabled', 'transport', 'host', 'port', 'username', 'password_file', 'from', 'to'}
        if set(config) - allowed:
            raise SafeError('TRANSPORT_CONFIG_FIELDS')
        if not isinstance(config.get('host'), str) or not re.fullmatch(r'[A-Za-z0-9.-]{1,253}', config['host']):
            raise SafeError('TRANSPORT_HOST')
        if type(config.get('port')) is not int or not 1 <= config['port'] <= 65535:
            raise SafeError('TRANSPORT_PORT')
        recipients = config.get('to')
        if not isinstance(recipients, list) or len(recipients) != 1:
            raise SafeError('ONE_APPROVED_RECIPIENT_REQUIRED')
        for address in [config.get('from'), *recipients]:
            if not isinstance(address, str) or not re.fullmatch(r'[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+', address) or len(address) > 254:
                raise SafeError('TRANSPORT_ADDRESS')
        self.config = config
        if not isinstance(config.get('username'), str) or not config['username'] or len(config['username']) > 254 or any(x in config['username'] for x in ['\r', '\n']):
            raise SafeError('TRANSPORT_USERNAME')
        self.context = ssl_context or ssl.create_default_context()
        if self.context.verify_mode != ssl.CERT_REQUIRED or not self.context.check_hostname:
            raise SafeError('TLS_VERIFICATION_REQUIRED')
        self.password = read_file(config['password_file'], 4096, private=True).decode('utf-8').strip()
        if not self.password or '\r' in self.password or '\n' in self.password:
            raise SafeError('TRANSPORT_SECRET_FORMAT')

    def send(self, event_id, payload):
        if not re.fullmatch(r'[a-f0-9]{64}', event_id):
            raise SafeError('EVENT_ID_INVALID')
        normalized = normalize_event(payload)
        if normalized is None:
            raise SafeError('EVENT_PAYLOAD_INVALID')
        payload = normalized[2]
        c = self.config
        message = email.message.EmailMessage()
        message['From'], message['To'] = c['from'], c['to'][0]
        message['Subject'] = 'NUAAFA operations ' + payload['kind']
        message['Message-ID'] = '<' + event_id + '@nuaafa-ops.invalid>'
        message.set_content(canonical({'event_id': event_id, **payload}))
        smtp = None
        try:
            try:
                smtp = smtplib.SMTP_SSL(c['host'], c['port'], timeout=10, context=self.context)
                smtp.login(c['username'], self.password)
            except (OSError, smtplib.SMTPException):
                raise RetryableTransport() from None
            try:
                smtp.send_message(message)
            except (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused, smtplib.SMTPDataError):
                # Explicit negative SMTP response means no successful recipient acceptance.
                raise RetryableTransport() from None
            # Any connection loss at DATA is uncertain and handled conservatively.
        finally:
            if smtp is not None:
                with contextlib.suppress(Exception):
                    smtp.close()


def _read_chunk(path, identity, offset, budget):
    fd = os.open(no_links(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or [st.st_dev, st.st_ino] != identity:
            raise SafeError('LOG_IDENTITY_CHANGED')
        os.lseek(fd, offset, os.SEEK_SET)
        data = os.read(fd, budget)
        complete_end = data.rfind(b'\n') + 1
        if (not complete_end and len(data) >= MAX_LINE) or any(len(x) > MAX_LINE for x in data[:complete_end].splitlines()):
            raise SafeError('LOG_LINE_SIZE_LIMIT')
        return data[:complete_end].splitlines(), offset + complete_end, max(0, os.fstat(fd).st_size - offset - complete_end)
    finally:
        os.close(fd)


def tail_lines(path, previous, initial_skip=True):
    """Bounded no-follow tail. Rename rotation drains matching .1 before new file.

    Does not guess missing rotations or compressed logs. Marks lost coverage.
    copytruncate is detected by size or prefix fingerprint, with a coverage gap.
    """
    path = no_links(path)
    st = path.stat()
    if not stat.S_ISREG(st.st_mode):
        raise SafeError('LOG_TYPE')
    identity = [st.st_dev, st.st_ino]
    prefix = hashlib.sha256(read_prefix(path)).hexdigest()
    if previous is None:
        offset = st.st_size if initial_skip else 0
        old_lines, gap = [], bool(initial_skip and st.st_size)
    else:
        offset = previous['offset']
        old_lines, gap = [], False
        if previous['identity'] != identity:
            rotated = path.with_name(path.name + '.1')
            if rotated.exists() and not rotated.is_symlink():
                rs = rotated.stat()
                if [rs.st_dev, rs.st_ino] == previous['identity'] and rs.st_size >= offset:
                    old_lines, old_offset, old_backlog = _read_chunk(rotated, previous['identity'], offset, MAX_READ // 2)
                    if old_backlog:
                        return old_lines, dict(previous, offset=old_offset, backlog_bytes=old_backlog, coverage_gap=True)
                else:
                    gap = True
            else:
                gap = True
            offset = 0
        elif st.st_size < offset or (previous.get('prefix_len', 0) and hashlib.sha256(read_prefix(path, previous['prefix_len'])).hexdigest() != previous['prefix']):
            offset, gap = 0, True
    lines, offset, backlog = _read_chunk(path, identity, offset, MAX_READ // 2)
    return old_lines + lines, dict(identity=identity, offset=offset, prefix=prefix, prefix_len=min(st.st_size, 256), backlog_bytes=backlog, coverage_gap=gap)


def read_prefix(path, size=256):
    fd = os.open(no_links(path), os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):raise SafeError('LOG_TYPE')
        return os.read(fd, size)
    finally:
        os.close(fd)


ACCESS = re.compile(rb'^\S+ \S+ \S+ \[([^\]]+)\] "(?:[^"\\]|\\.)*" ([1-5][0-9]{2}) (?:[0-9]+|-)')
ACCESS_MINIMAL = re.compile(rb'([0-9]{1,12}(?:\.[0-9]{1,3})?) ([1-5][0-9]{2})\Z')
CATEGORIES = {
    'PUBLIC_READ_UNAVAILABLE': re.compile(rb'\[public-read\] unavailable'),
    'SQLITE_BUSY_LOCKED': re.compile(rb'\b(?:SQLITE_BUSY(?:_\w+)?|SQLITE_LOCKED(?:_\w+)?|database is locked)\b', re.I),
    'PRISMA_INITIALIZATION': re.compile(rb'\bPrismaClientInitializationError\b'),
    'PRISMA_QUERY': re.compile(rb'\bPrismaClient(?:KnownRequest|UnknownRequest|Validation)Error\b'),
}


def aggregate(lines, previous, epoch, mode, window_seconds=900):
    """Only per-second numerical buckets; never retain raw URL/IP/SQL/message."""
    buckets = {int(k): dict(v) for k, v in previous.items() if epoch - int(k) < window_seconds}
    malformed = 0
    for line in lines:
        if mode in {'access','access_minimal'}:
            minimal=ACCESS_MINIMAL.fullmatch(line)
            match=ACCESS.match(line)if mode=='access'and not minimal else minimal
            if not match:
                malformed+=1;continue
            try:
                observed=float(match[1])if minimal else dt.datetime.strptime(match[1].decode('ascii'), '%d/%b/%Y:%H:%M:%S %z').timestamp()
            except (ValueError,UnicodeDecodeError):malformed+=1;continue
            if not 0 <= epoch - observed < window_seconds:
                continue
            second = int(observed)
            item = buckets.setdefault(second, {'requests': 0, 'server_errors': 0})
            item['requests'] += 1
            item['server_errors'] += int(500 <= int(match[2]) <= 599)
        elif mode == 'application':
            item = buckets.setdefault(int(epoch), {k: 0 for k in CATEGORIES})
            for category, pattern in CATEGORIES.items():
                item[category] += bool(pattern.search(line))
        else:
            raise SafeError('LOG_MODE_INVALID')
    totals = {}
    for bucket in buckets.values():
        for k, v in bucket.items():
            totals[k] = totals.get(k, 0) + v
    if mode in {'access','access_minimal'}:
        totals.setdefault('requests', 0)
        totals.setdefault('server_errors', 0)
        totals['server_error_ratio'] = totals['server_errors'] / max(1, totals['requests'])
    return buckets, dict(totals, malformed_lines=malformed, window_seconds=window_seconds)


def bounded_stdout(args):
    """No unbounded command output or diagnostic stderr in the monitoring chain."""
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    data = bytearray()
    started = time.monotonic()
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(proc.stdout, selectors.EVENT_READ)
            while True:
                if time.monotonic() - started > 10:
                    raise SafeError('JOURNAL_READ_TIMEOUT')
                if not selector.select(.1):
                    continue
                chunk = os.read(proc.stdout.fileno(), 65536)
                if not chunk:
                    break
                data.extend(chunk)
                if len(data) > MAX_READ:
                    raise SafeError('JOURNAL_READ_LIMIT')
        if proc.wait(timeout=1) != 0:
            raise SafeError('JOURNAL_READ_FAILED')
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.wait()
        proc.stdout.close()
    return data


def read_journal(cursor, epoch, *, command=None):
    """Bounded, read-only unit-scoped journal. Never print/persist raw messages.

    command is an in-process test seam, unavailable in CLI/configuration.
    A failed/oversized read has no cursor advancement and becomes an explicit
    collector failure, rather than skipping an unknown amount of journal data.
    """
    args = list(command or ['/usr/bin/journalctl']) + [
        '--unit=nuaafa.service', '--output=json', '--no-pager', '--quiet', '--no-tail',
        '--output-fields=MESSAGE,__CURSOR,__REALTIME_TIMESTAMP']
    if cursor:
        if not isinstance(cursor, str) or len(cursor) > 4096 or not re.fullmatch(r'[A-Za-z0-9;=_-]+', cursor):
            raise SafeError('JOURNAL_CURSOR_INVALID')
        args.append('--after-cursor=' + cursor)
    else:
        args.append('--since=@' + str(int(epoch - 900)))
    data = bounded_stdout(args)
    if data.strip()==b'-- No entries --':
        return [],cursor
    result = []
    last = cursor
    for raw in data.splitlines():
        if len(raw) > MAX_LINE:
            raise SafeError('JOURNAL_LINE_LIMIT')
        try:
            value = json.loads(raw)
            last = value['__CURSOR']
            stamp = int(value['__REALTIME_TIMESTAMP']) / 1000000
            message = value['MESSAGE']
            if not isinstance(last, str) or not re.fullmatch(r'[A-Za-z0-9;=_-]{1,4096}', last) or not isinstance(message, str) or stamp > epoch + 10:
                raise ValueError()
        except (ValueError, KeyError, TypeError):
            raise SafeError('JOURNAL_ENVELOPE_INVALID') from None
        if 0 <= epoch - stamp < 900:
            result.append((stamp, message.encode()))
    return result, last


def read_journal_aggregates(cursor, epoch):
    if cursor:
        if not isinstance(cursor, str) or not re.fullmatch(r'[A-Za-z0-9;=_-]{1,4096}', cursor):
            raise SafeError('JOURNAL_CURSOR_INVALID')
    value = root_input('journal',cursor)
    if not isinstance(value, dict) or set(value) != {'cursor', 'buckets'} or not isinstance(value['buckets'], dict):
        raise SafeError('JOURNAL_AGGREGATE_INVALID')
    last = value['cursor']
    if last is not None and (not isinstance(last, str) or not re.fullmatch(r'[A-Za-z0-9;=_-]{1,4096}', last)):
        raise SafeError('JOURNAL_CURSOR_INVALID')
    for stamp, counts in value['buckets'].items():
        if not stamp.isdigit() or not 0 <= epoch - int(stamp) < 910 or not isinstance(counts, dict) or set(counts) != set(CATEGORIES) or any(type(n) is not int or n < 0 for n in counts.values()):
            raise SafeError('JOURNAL_AGGREGATE_INVALID')
    return value['buckets'], last


def root_input(source, cursor=None):
    if source not in {'monitor','access','journal'}:
        raise SafeError('FIXED_INPUT_SOURCE_REQUIRED')
    if os.geteuid()!=0:
        raise SafeError('ROOT_FIXED_INPUT_REQUIRED')
    if cursor is not None and len(canonical(cursor))>8192:
        raise SafeError('INPUT_CURSOR_SIZE')
    # Root collector is sandboxed with a read-only filesystem, no network,
    # DAC_READ_SEARCH only and inaccessible business/SMTP paths. No sudo chain.
    return read_fixed_input(source,cursor,time.time())


def read_fixed_input(source, cursor, epoch):
    """Called only by sealed root bridge; source paths cannot come from argv."""
    if source=='journal':
        records,last=read_journal(cursor,epoch)
        buckets={}
        for stamp,message in records:
            buckets,_=aggregate([message],buckets,stamp,'application')
        buckets,_=aggregate([],buckets,epoch,'application')
        return {'cursor':last,'buckets':buckets}
    if cursor is not None:
        if not isinstance(cursor,dict) or set(cursor)-{'identity','offset','prefix','prefix_len','backlog_bytes','coverage_gap'}:
            raise SafeError('INPUT_CURSOR_INVALID')
        if not isinstance(cursor.get('identity'),list) or len(cursor['identity'])!=2 or any(type(n)is not int or n<0 for n in cursor['identity']) or type(cursor.get('offset'))is not int or cursor['offset']<0:
            raise SafeError('INPUT_CURSOR_INVALID')
        if not isinstance(cursor.get('prefix'),str) or not re.fullmatch(r'[a-f0-9]{64}',cursor['prefix']) or type(cursor.get('prefix_len'))is not int or not 0<=cursor['prefix_len']<=256:
            raise SafeError('INPUT_CURSOR_INVALID')
    if source=='access':
        # Current enabled NUAAFA server inherits this global combined log. Its
        # hidden-file deny location alone disables logging. Scope must be rechecked
        # if another virtual host/config is added; no arbitrary filename option.
        lines,next_cursor=tail_lines(Path('/var/log/nginx/access.log'),cursor)
        buckets,totals=aggregate(lines,{},epoch,'access')
        return {'cursor':next_cursor,'buckets':buckets,'malformed':totals['malformed_lines']}
    if source=='monitor':
        lines,next_cursor=tail_lines(Path('/var/lib/nuaafa-ops-monitor/events.jsonl'),cursor)
        events=[];invalid=0
        for line in lines:
            try:
                normalized=normalize_event(json.loads(line))
                if normalized:events.append(normalized[2])
            except (ValueError,SafeError):invalid+=1
        latest=json.loads(read_file(Path('/var/lib/nuaafa-ops-monitor/latest.json')))
        try:
            observed=dt.datetime.fromisoformat(latest['utc'].replace('Z','+00:00'))
            if observed.tzinfo is None or not 0<=epoch-observed.timestamp()<=MONITOR_SOURCE_MAX_AGE_SECONDS:
                raise ValueError()
        except (ValueError,KeyError,TypeError,AttributeError):
            raise SafeError('ORIGINAL_MONITOR_SOURCE_STALE')from None
        state={}
        for check,value in latest.get('state',{}).items():
            if check in CHECKS and isinstance(value,dict) and value.get('alerted')is True:
                state[check]={'alerted':True,'since':number(value.get('since'))}
        return {'cursor':next_cursor,'events':events,'active':state,'invalid':invalid}
    raise SafeError('FIXED_INPUT_SOURCE_REQUIRED')


def collect_logs(outbox, access, application, epoch, min_requests, min_errors, error_ratio, *, journal_command=None):
    if min_requests < 1 or min_errors < 1 or not 0 < error_ratio <= 1:
        raise SafeError('METRIC_POLICY_INVALID')
    outputs, health = {}, True
    with outbox.db:
        for mode, filename in [('access', access), ('application', application)]:
            old = outbox.metadata('log-' + mode, {})
            if mode == 'application' and filename is None:
                buckets = old.get('buckets', {})
                if journal_command is not None:  # in-process fictional test seam
                    entries, last = read_journal(old.get('journal_cursor'), epoch, command=journal_command)
                    for stamp, message in entries:
                        buckets, _ = aggregate([message], buckets, stamp, 'application')
                else:
                    additions, last = read_journal_aggregates(old.get('journal_cursor'), epoch)
                    for stamp, counts in additions.items():
                        item = buckets.setdefault(int(stamp), {k: 0 for k in CATEGORIES})
                        for category, count in counts.items():
                            item[category] += count
                buckets, total = aggregate([], buckets, epoch, 'application')
                cursor = dict(coverage_gap=not old.get('journal_initialized', False), backlog_bytes=0)
            else:
                lines, cursor = tail_lines(filename, old.get('cursor'))
                buckets, total = aggregate(lines, old.get('buckets', {}), epoch, mode)
            outbox.put_metadata('log-' + mode, {'cursor': cursor, 'buckets': buckets})
            if mode == 'application' and filename is None:
                outbox.put_metadata('log-application', {'buckets': buckets, 'journal_cursor': last, 'journal_initialized': True})
            outputs[mode] = dict(total, coverage_gap=cursor['coverage_gap'], backlog_bytes=cursor['backlog_bytes'])
            health = health and not cursor['coverage_gap'] and not cursor['backlog_bytes'] and total['malformed_lines'] == 0
        access_ok = not (outputs['access']['requests'] >= min_requests and outputs['access']['server_errors'] >= min_errors and outputs['access']['server_error_ratio'] >= error_ratio)
        app_ok = not any(outputs['application'].get(k, 0) for k in CATEGORIES)
        checks = {'HTTP_5XX_WINDOW': access_ok, 'APPLICATION_DATABASE_ERRORS': app_ok, 'LOG_COLLECTOR_HEALTH': health}
        state, events = advance(outbox.metadata('metric-incidents', {}), checks, epoch)
        outbox.put_metadata('metric-incidents', state)
        for event in events:
            outbox.enqueue(event)
    return {'checks': checks, 'aggregates': outputs, 'events': len(events)}


def atomic_handoff(path, data, group):
    temp = path.with_name(path.name + '.' + hashlib.sha256(os.urandom(32)).hexdigest() + '.tmp')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o640)
    try:
        os.fchown(fd, -1, group)
        os.fchmod(fd, 0o640)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        os.replace(temp, path)
        directory = os.open(path.parent, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        with contextlib.suppress(FileNotFoundError):
            temp.unlink()


def export_handoff(box, directory, max_bytes, active_state, *, after_fsync=None, epoch=None):
    """DB is the authority. Fsync precedes export acknowledgement; replay is safe.

    A damaged/truncated handoff is rebuilt from retained DB events, never from
    only the still-PENDING subset. No automatic event deletion or retention.
    """
    directory = no_links(directory)
    st = directory.stat()
    if st.st_uid != os.getuid() or stat.S_IMODE(st.st_mode) != 0o750 or st.st_gid not in set(os.getgroups()) | {os.getgid()} or not 1024 <= max_bytes <= 64*1024*1024:
        raise SafeError('HANDOFF_DIRECTORY_PERMISSION_OR_BUDGET')
    group = st.st_gid
    path = directory/'events.jsonl'
    expected = box.metadata('handoff-identity')
    exists = path.exists() or path.is_symlink()
    managed=box.metadata('handoff-managed')
    if managed is None:
        if exists or any(directory.iterdir()):
            raise SafeError('UNRECOGNIZED_HANDOFF_NOT_OVERWRITTEN')
        with box.db:
            box.put_metadata('handoff-managed',{'directory':str(directory)})
    elif managed!={'directory':str(directory)}:
        raise SafeError('HANDOFF_DIRECTORY_CHANGED')
    if exists:
        ps = path.lstat()
        if path.is_symlink() or not stat.S_ISREG(ps.st_mode) or ps.st_uid != os.getuid() or ps.st_gid != group or stat.S_IMODE(ps.st_mode) != 0o640 or ps.st_nlink != 1:
            raise SafeError('HANDOFF_FILE_PERMISSION')
    all_rows = box.db.execute('SELECT id,payload FROM events ORDER BY json_extract(payload,\'$.since_epoch\'), CASE kind WHEN \'INCIDENT_OPEN\' THEN 0 ELSE 1 END').fetchall()
    encoded = lambda row: (canonical(dict(json.loads(row['payload']), event_id=row['id']))+'\n').encode()
    size = sum(len(encoded(row)) for row in all_rows)
    if size > max_bytes:
        raise SafeError('HANDOFF_CAPACITY_REQUIRES_REVIEW')
    fs=os.statvfs(directory)
    if fs.f_bavail*fs.f_frsize < 5*1024**3 + size:
        raise SafeError('HANDOFF_FREE_SPACE_REQUIRES_REVIEW')
    if (box.root/'outbox.sqlite').stat().st_size > 64*1024*1024:
        raise SafeError('COLLECTOR_DATABASE_CAPACITY_REQUIRES_REVIEW')
    actual = read_file(path, max_bytes) if exists else b''
    good = expected is not None and exists and len(actual) == expected['bytes'] and hashlib.sha256(actual).hexdigest() == expected['sha256']
    if not good:
        data = b''.join(encoded(row) for row in all_rows)
        atomic_handoff(path, data, group)
        mode = 'REBUILT_FROM_DURABLE_EVENTS'
    else:
        pending = box.db.execute("SELECT id,payload FROM events WHERE status!='EXPORTED' ORDER BY rowid").fetchall()
        data = actual + b''.join(encoded(row) for row in pending)
        if len(data) > max_bytes:
            raise SafeError('HANDOFF_CAPACITY_REQUIRES_REVIEW')
        if pending:
            fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW)
            with os.fdopen(fd, 'ab') as stream:
                stream.write(data[len(actual):]); stream.flush(); os.fsync(stream.fileno())
        mode = 'APPENDED_FSYNCED'
    if after_fsync:
        after_fsync()  # test seam: simulate crash before durable acknowledgement
    with box.db:
        box.db.execute("UPDATE events SET status='EXPORTED',code='HANDOFF_DURABLE' WHERE status!='EXPORTED'")
        box.put_metadata('handoff-identity', dict(bytes=len(data),sha256=hashlib.sha256(data).hexdigest()))
    snapshot = canonical({'state': active_state,'collected_epoch':time.time()if epoch is None else epoch}).encode()+b'\n'
    atomic_handoff(directory/'latest.json', snapshot, group)
    return dict(mode=mode, events=len(all_rows), bytes=len(data), max_bytes=max_bytes)


def bridge_cycle(box, original_events, original_latest, access, application, handoff, epoch,
                 min_requests, min_errors, error_ratio, max_bytes, *, journal_command=None):
    if (box.root/'outbox.sqlite').stat().st_size > 64*1024*1024:
        raise SafeError('COLLECTOR_DATABASE_CAPACITY_REQUIRES_REVIEW')
    box.ingest(original_events)
    # Every current active original incident is bootstrapped, idempotently. No
    # dependency on whether original event history predates sidecar installation.
    box.bootstrap_current(original_latest, epoch)
    result = collect_logs(box, access, application, epoch, min_requests, min_errors, error_ratio,
                          journal_command=journal_command)
    original = json.loads(read_file(original_latest)).get('state', {})
    active = {}
    for check, value in original.items():
        if check in CHECKS and isinstance(value, dict) and value.get('alerted') is True:
            active[check] = {'alerted': True, 'since': number(value.get('since'))}
    for check, value in box.metadata('metric-incidents', {}).items():
        if value.get('alerted') is True:
            active[check] = {'alerted': True, 'since': number(value.get('since'))}
    return dict(metrics=result, handoff=export_handoff(box, handoff, max_bytes, active,epoch=epoch))


def fixed_bridge_cycle(box,handoff,epoch,min_requests,min_errors,error_ratio,max_bytes,*,reader=root_input):
    """Production candidate interface: numeric/allowlisted privileged inputs only."""
    if (box.root/'outbox.sqlite').stat().st_size>64*1024*1024:
        raise SafeError('COLLECTOR_DATABASE_CAPACITY_REQUIRES_REVIEW')
    if min_requests<1 or min_errors<1 or not 0<error_ratio<=1:
        raise SafeError('METRIC_POLICY_INVALID')
    with box.db:
        monitor=reader('monitor',box.metadata('root-monitor-cursor'))
        if set(monitor)!={'cursor','events','active','invalid'} or not isinstance(monitor['events'],list) or not isinstance(monitor['active'],dict):
            raise SafeError('INPUT_ENVELOPE_INVALID')
        for event in monitor['events']:box.enqueue(event)
        active={}
        for check,state in monitor['active'].items():
            if check not in CHECKS or not isinstance(state,dict) or state.get('alerted')is not True:
                raise SafeError('INPUT_ACTIVE_INVALID')
            since=number(state.get('since'));active[check]={'alerted':True,'since':since}
            box.enqueue(dict(kind='INCIDENT_OPEN',check=check,since_epoch=since,detected_epoch=epoch))
        box.put_metadata('root-monitor-cursor',monitor['cursor'])
        healthy=monitor['invalid']==0 and not monitor['cursor']['backlog_bytes'] and not monitor['cursor']['coverage_gap']
        totals={}
        for source in ['access','journal']:
            old=box.metadata('root-'+source,{})
            value=reader(source,old.get('cursor'))
            expected={'cursor','buckets','malformed'} if source=='access' else {'cursor','buckets'}
            if set(value)!=expected or not isinstance(value['buckets'],dict):raise SafeError('INPUT_ENVELOPE_INVALID')
            merged={int(k):dict(v) for k,v in old.get('buckets',{}).items() if 0<=epoch-int(k)<900}
            allowed={'requests','server_errors'} if source=='access' else set(CATEGORIES)
            for stamp,counts in value['buckets'].items():
                if not str(stamp).isdigit() or not 0<=epoch-int(stamp)<910 or not isinstance(counts,dict) or set(counts)!=allowed or any(type(v)is not int or v<0 for v in counts.values()):
                    raise SafeError('INPUT_COUNTER_INVALID')
                item=merged.setdefault(int(stamp),{k:0 for k in allowed})
                for key,count in counts.items():item[key]+=count
            total={key:sum(b.get(key,0) for b in merged.values()) for key in allowed}
            totals[source]=total
            if source=='access':
                healthy=healthy and not value['malformed'] and not value['cursor']['backlog_bytes'] and not value['cursor']['coverage_gap']
            box.put_metadata('root-'+source,{'cursor':value['cursor'],'buckets':merged})
        access=totals['access']
        checks={'HTTP_5XX_WINDOW':not(access['requests']>=min_requests and access['server_errors']>=min_errors and access['server_errors']/max(1,access['requests'])>=error_ratio),
                'APPLICATION_DATABASE_ERRORS':not any(totals['journal'].values()),'LOG_COLLECTOR_HEALTH':healthy}
        states,events=advance(box.metadata('metric-incidents',{}),checks,epoch)
        box.put_metadata('metric-incidents',states)
        for event in events:box.enqueue(event)
        for check,state in states.items():
            if state.get('alerted'):active[check]={'alerted':True,'since':state['since']}
    identity={'uid':os.geteuid(),'gid':os.getegid()}
    if Path('/proc/self/status').is_file():
        identity.update({k:v.strip()for k,v in(line.split(':',1)for line in Path('/proc/self/status').read_text().splitlines()if ':'in line)if k in {'CapEff','CapBnd','NoNewPrivs'}})
    return {'checks':checks,'handoff':export_handoff(box,handoff,max_bytes,active,epoch=epoch),'runtime_identity':identity}


def consume_handoff(box,directory,epoch,max_age_seconds):
    """Sender independently detects collector failure even with an empty outbox."""
    if not 60<=max_age_seconds<=86400:raise SafeError('FRESHNESS_POLICY_INVALID')
    directory=no_links(directory)
    okay=True;inserted=0;failure='NONE'
    try:
        result=box.ingest(directory/'events.jsonl',from_start=True)
        inserted=result['inserted']
        latest=json.loads(read_file(directory/'latest.json'))
        observed=number(latest.get('collected_epoch'))
        okay=0<=epoch-observed<=max_age_seconds and result['invalid']==0 and result['backlog_bytes']==0
        if okay:
            # The source is a private read-only snapshot, never arbitrary paths.
            box.bootstrap_current(directory/'latest.json',epoch)
        else:failure='STALE_OR_INCOMPLETE_COLLECTOR_INPUT'
    except (OSError,ValueError,SafeError,AttributeError,TypeError):
        okay=False;failure='COLLECTOR_INPUT_UNAVAILABLE'
    with box.db:
        states,events=advance(box.metadata('sender-collector-health',{}),{'COLLECTOR_INPUT_FRESHNESS':okay},epoch)
        box.put_metadata('sender-collector-health',states)
        for event in events:box.enqueue(event)
    return {'collector_input_ok':okay,'code':failure,'inserted':inserted,'health_events':len(events)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir', required=True)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('ingest'); p.add_argument('--events', required=True); p.add_argument('--from-start', action='store_true')
    p = sub.add_parser('bootstrap'); p.add_argument('--latest', required=True)
    p=sub.add_parser('consume');p.add_argument('--handoff',required=True);p.add_argument('--max-age-seconds',required=True,type=int)
    p = sub.add_parser('collect'); p.add_argument('--access', required=True)
    source = p.add_mutually_exclusive_group(required=True); source.add_argument('--application'); source.add_argument('--journal', action='store_true')
    p.add_argument('--min-requests', required=True, type=int); p.add_argument('--min-errors', required=True, type=int); p.add_argument('--error-ratio', required=True, type=float)
    p = sub.add_parser('bridge'); p.add_argument('--events', required=True); p.add_argument('--latest', required=True); p.add_argument('--access', required=True); p.add_argument('--handoff', required=True)
    source=p.add_mutually_exclusive_group(required=True);source.add_argument('--application');source.add_argument('--journal',action='store_true')
    p.add_argument('--min-requests',required=True,type=int);p.add_argument('--min-errors',required=True,type=int);p.add_argument('--error-ratio',required=True,type=float)
    p.add_argument('--max-handoff-bytes',required=True,type=int)
    p=sub.add_parser('fixed-bridge');p.add_argument('--handoff',required=True)
    p.add_argument('--min-requests',required=True,type=int);p.add_argument('--min-errors',required=True,type=int);p.add_argument('--error-ratio',required=True,type=float);p.add_argument('--max-handoff-bytes',required=True,type=int)
    p = sub.add_parser('send'); p.add_argument('--config', required=True); p.add_argument('--max-attempts', type=int, default=4)
    sub.add_parser('status')
    args = parser.parse_args()
    os.umask(0o077)
    try:
        with Outbox(args.state_dir) as box:
            if args.command == 'ingest':
                result = box.ingest(args.events, from_start=args.from_start)
            elif args.command == 'bootstrap':
                result = box.bootstrap_current(args.latest, time.time())
            elif args.command=='consume':
                result=consume_handoff(box,args.handoff,time.time(),args.max_age_seconds)
            elif args.command == 'collect':
                result = collect_logs(box, args.access, args.application, time.time(), args.min_requests, args.min_errors, args.error_ratio)
            elif args.command == 'bridge':
                result = bridge_cycle(box,args.events,args.latest,args.access,args.application,args.handoff,time.time(),args.min_requests,args.min_errors,args.error_ratio,args.max_handoff_bytes)
            elif args.command == 'fixed-bridge':
                result=fixed_bridge_cycle(box,args.handoff,time.time(),args.min_requests,args.min_errors,args.error_ratio,args.max_handoff_bytes)
            elif args.command == 'send':
                result = box.dispatch(SMTPTransport(args.config), time.time(), max_attempts=args.max_attempts)
            else:
                result = box.summary()
            health = box.health(time.time())
            print(canonical({'status': 'PASS' if health['ok'] else 'DEGRADED', 'result': result, 'notification_health': health}))
            # Ordered sender setup stages must not strand an aged queue before
            # send can drain it. The final send/status process exposes exit2.
            return 0 if health['ok'] or args.command in {'ingest','bootstrap','consume'} else 2
    except Exception as error:
        code = str(error) if isinstance(error, SafeError) else type(error).__name__
        print(canonical({'status': 'FAIL', 'code': code}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
