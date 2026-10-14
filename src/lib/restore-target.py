#!/usr/bin/python3 -I
"""Descriptor-relative isolated restore. No overwrite fallback and no recursive cleanup.

The allowed root is an inode boundary, pinned for the operation. Directory
replacement never redirects a write through a newly installed path/symlink.
Namespace identity changes observed before publication fail closed. As with
the other deployment guards, root and the invoking UID are trusted principals;
a process with the same credentials can already modify the source/targets.
Failed or interrupted operations retain private staging and any published
entry for explicit diagnosis: unlink-after-lstat cannot safely undo a paired
publication when another process may replace its destination.
"""
import ctypes
import errno
import fcntl
import hashlib
import json
import os
from pathlib import PurePosixPath
import stat
import sys
import uuid

DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC


def require(condition, message):
    if not condition:
        raise ValueError(message)


def identity(info):
    return info.st_dev, info.st_ino


def absolute(value):
    require(isinstance(value, str) and value.startswith("/") and os.path.normpath(value) == value,
            "restore requires normalized absolute canonical paths")
    require("\x00" not in value, "invalid restore path")
    return value


class Directories:
    def __init__(self):
        self.handles = {"/": os.open("/", DIR_FLAGS)}
        self.source_identity = None

    def pin(self, value, create=False):
        value = absolute(value)
        current = "/"
        for part in PurePosixPath(value).parts[1:]:
            parent = current
            current = os.path.join(parent, part)
            if current in self.handles:
                continue
            try:
                fd = os.open(part, DIR_FLAGS, dir_fd=self.handles[parent])
            except FileNotFoundError:
                if not create:
                    raise
                self.unchanged()
                self.trusted_ancestors(parent)
                self.no_write_into_source(parent)
                os.mkdir(part, 0o700, dir_fd=self.handles[parent])
                fd = os.open(part, DIR_FLAGS, dir_fd=self.handles[parent])
            self.handles[current] = fd
            if create:
                self.no_write_into_source(current)
        return self.handles[value]

    def existing_ancestor(self, value):
        """Read-only plan: pin every existing component, never mkdir."""
        value = absolute(value)
        current = "/"
        parts = PurePosixPath(value).parts[1:]
        for index, part in enumerate(parts):
            candidate = os.path.join(current, part)
            try:
                self.pin(candidate)
            except FileNotFoundError:
                return current, parts[index:]
            current = candidate
        return current, ()

    def ancestors(self, value):
        return {identity(os.fstat(self.handles[str(part)]))
                for part in (PurePosixPath(value), *PurePosixPath(value).parents)}

    def no_write_into_source(self, value):
        require(self.source_identity not in self.ancestors(value),
                "restore destination aliases or lies inside source backup")

    def disjoint_from_source(self, plan, source_ancestors):
        ancestor, missing = plan
        self.no_write_into_source(ancestor)
        # If components are missing, this is a new branch below the pinned
        # existing ancestor. Otherwise also reject an ancestor OF the source.
        require(missing or identity(os.fstat(self.handles[ancestor])) not in source_ancestors,
                "restore destination is an actual ancestor of source backup")

    def unchanged(self, ignore_prefix=None):
        for value, fd in self.handles.items():
            if value == "/":
                continue
            if ignore_prefix and (value == ignore_prefix or value.startswith(ignore_prefix + "/")):
                continue
            parent, name = os.path.split(value)
            entry = os.stat(name, dir_fd=self.handles[parent], follow_symlinks=False)
            require(stat.S_ISDIR(entry.st_mode) and identity(entry) == identity(os.fstat(fd)),
                    "restore ancestor was replaced; publication refused")

    def close(self):
        for fd in reversed(list(self.handles.values())):
            os.close(fd)

    def trusted_ancestors(self, value):
        # Protect the pinned tree against OTHER credentials renaming its root
        # or intermediate directories. Root-owned sticky /tmp is permitted.
        for part in (PurePosixPath(value), *PurePosixPath(value).parents):
            info = os.fstat(self.handles[str(part)])
            require(info.st_uid in (0, os.geteuid()), "restore ancestor has an untrusted owner")
            writable = info.st_mode & 0o022
            sticky_root = info.st_uid == 0 and info.st_mode & stat.S_ISVTX
            require(not writable or sticky_root, "restore ancestor allows untrusted namespace replacement")


def native_no_replace():
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == "linux":
        function, flag = getattr(libc, "renameat2", None), 1  # RENAME_NOREPLACE
    elif sys.platform == "darwin":
        function, flag = getattr(libc, "renameatx_np", None), 4  # RENAME_EXCL
    else:
        raise ValueError("safe restore requires Linux renameat2 or Darwin renameatx_np")
    require(function is not None, "atomic no-replace API is unavailable; no rename fallback")
    function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    function.restype = ctypes.c_int

    def move(source_fd, source, target_fd, target):
        if function(source_fd, os.fsencode(source), target_fd, os.fsencode(target), flag) != 0:
            code = ctypes.get_errno()
            raise OSError(code, os.strerror(code), target)
    return move


def absent(fd, name):
    try:
        os.stat(name, dir_fd=fd, follow_symlinks=False)
    except FileNotFoundError:
        return
    raise FileExistsError(errno.EEXIST, "restore destination already exists", name)


def read_json():
    line = sys.stdin.readline(64 * 1024 * 1024)
    require(line.endswith("\n"), "restore controller disconnected or request too large")
    return json.loads(line)


def emit(value):
    print(json.dumps(value), flush=True)


def file_digest(fd):
    os.lseek(fd, 0, os.SEEK_SET)
    digest, count = hashlib.sha256(), 0
    while True:
        chunk = os.read(fd, 1024 * 1024)
        if not chunk:
            return count, digest.hexdigest()
        count += len(chunk)
        digest.update(chunk)


def copy_verified(source_fd, name, target_fd, target, expected):
    source = os.open(name, FILE_FLAGS, dir_fd=source_fd)
    try:
        require(stat.S_ISREG(os.fstat(source).st_mode), "restore source is not a regular file")
        destination = os.open(target, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                              0o600, dir_fd=target_fd)
        try:
            while True:
                chunk = os.read(source, 1024 * 1024)
                if not chunk:
                    break
                view = memoryview(chunk)
                while view:
                    written = os.write(destination, view)
                    require(written > 0, "short restore write")
                    view = view[written:]
            os.fsync(destination)
            require(file_digest(destination) == (expected["bytes"], expected["sha256"]),
                    "staged restore checksum or size validation failed")
            return identity(os.fstat(destination))
        finally:
            os.close(destination)
    finally:
        os.close(source)


def verify_files(fd, prefix=""):
    result = {}
    for name in os.listdir(fd):
        info = os.stat(name, dir_fd=fd, follow_symlinks=False)
        relative = prefix + name
        if stat.S_ISDIR(info.st_mode):
            child = os.open(name, DIR_FLAGS, dir_fd=fd)
            try:
                require(identity(info) == identity(os.fstat(child)), "staged directory changed")
                result.update(verify_files(child, relative + "/"))
            finally:
                os.close(child)
        else:
            require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "unsafe staged restore entry")
            child = os.open(name, FILE_FLAGS, dir_fd=fd)
            try:
                require(identity(info) == identity(os.fstat(child)), "staged file changed")
                result[relative] = file_digest(child)
            finally:
                os.close(child)
    return result


def child_directory(fd, name):
    os.mkdir(name, 0o700, dir_fd=fd)
    return os.open(name, DIR_FLAGS, dir_fd=fd)


def main():
    request = read_json()
    require(request.get("command") == "prepare", "invalid restore protocol")
    move = native_no_replace()  # Fail before making any destination without this API.
    root, source = absolute(request["allowedRoot"]), absolute(request["source"])
    database, uploads = absolute(request["database"]), absolute(request["uploads"])
    require(root != "/" and root != source and not root.startswith(source + "/"),
            "restore root aliases or lies inside source backup")
    for target in (database, uploads):
        require(target.startswith(root + "/") and not target.startswith(source + "/") and
                not source.startswith(target + "/"),
                "restore target outside allowed root or aliases source")
    require(database != uploads and not database.startswith(uploads + "/") and
            not uploads.startswith(database + "/"), "restore destinations overlap")
    require(all(os.path.basename(value) != ".nuaafa-restore.lock" for value in (database, uploads)),
            "reserved restore target")
    directories = Directories()
    handles = []
    operation = None
    published = []
    try:
        source_fd = directories.pin(source)
        directories.source_identity = identity(os.fstat(source_fd))
        source_ancestors = directories.ancestors(source)
        # All overlap/permission/existence checks are READ ONLY. Resolve actual
        # identities, including case/firmlink aliases, before ANY mkdir/lock/probe.
        plans = {value: directories.existing_ancestor(value) for value in
                 (root, os.path.dirname(database), os.path.dirname(uploads))}
        directories.unchanged()
        for value, plan in plans.items():
            directories.disjoint_from_source(plan, source_ancestors)
            ancestor, missing = plan
            directories.trusted_ancestors(ancestor)
            if not missing:
                info = os.fstat(directories.handles[ancestor])
                require(info.st_uid == os.geteuid() and not info.st_mode & 0o022,
                        "restore root/target parent is not controlled by invoking UID")
        for target in (database, uploads):
            ancestor, missing = plans[os.path.dirname(target)]
            if not missing:
                absent(directories.handles[ancestor], os.path.basename(target))
        # Reject existing symlink ancestors, including the allowed root, before staging.
        root_fd = directories.pin(root, create=True)
        root_info = os.fstat(root_fd)
        directories.trusted_ancestors(root)
        require(root_info.st_uid == os.geteuid() and not root_info.st_mode & 0o022,
                "restore root must be owned by the invoking UID and not group/other writable")
        db_parent = directories.pin(os.path.dirname(database), create=True)
        upload_parent = directories.pin(os.path.dirname(uploads), create=True)
        directories.trusted_ancestors(os.path.dirname(database))
        directories.trusted_ancestors(os.path.dirname(uploads))
        directories.unchanged()
        for parent in (db_parent, upload_parent):
            info = os.fstat(parent)
            require(info.st_uid == os.geteuid() and not info.st_mode & 0o022,
                    "restore target parent is not controlled by invoking UID")
        absent(db_parent, os.path.basename(database))
        absent(upload_parent, os.path.basename(uploads))
        lock = os.open(".nuaafa-restore.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC,
                       0o600, dir_fd=root_fd)
        handles.append(lock)
        info = os.fstat(lock)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_uid == os.geteuid() and
                not info.st_mode & 0o077, "unsafe restore operation lock")
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        operation_name = ".restore-" + str(uuid.uuid4())
        operation = os.path.join(root, operation_name)
        stage = child_directory(root_fd, operation_name)
        handles.append(stage)
        directories.handles[operation] = os.dup(stage)
        journal = os.open("operation.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                          0o600, dir_fd=stage)
        try:
            with os.fdopen(journal, "w") as output:
                json.dump(dict(format=1, pid=os.getpid(), source=source, database=database,
                               uploads=uploads, databaseSha256=request["databaseFile"]["sha256"],
                               cleanup="retain; never unlink potentially replaced destinations"), output)
                output.flush()
                os.fsync(output.fileno())
        except BaseException:
            raise
        stage_uploads = child_directory(stage, "uploads")
        handles.append(stage_uploads)
        # Prove this filesystem implements no-replace for files AND directories.
        for kind in ("file", "directory"):
            names = ["probe-" + kind + "-a", "probe-" + kind + "-b"]
            for name in names:
                if kind == "file":
                    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600, dir_fd=stage)
                    os.close(fd)
                else:
                    os.mkdir(name, 0o700, dir_fd=stage)
            before = [identity(os.stat(name, dir_fd=stage)) for name in names]
            try:
                move(stage, names[0], stage, names[1])
                raise ValueError("filesystem ignored atomic no-replace")
            except OSError as error:
                require(error.errno == errno.EEXIST, "filesystem lacks atomic no-replace support")
            require(before == [identity(os.stat(name, dir_fd=stage)) for name in names],
                    "filesystem changed no-replace probe entries")
        expected = {"database.sqlite": (request["databaseFile"]["bytes"], request["databaseFile"]["sha256"])}
        db_identity = copy_verified(source_fd, "database.sqlite", stage, "database.sqlite", request["databaseFile"])
        for entry in request["files"]:
            relative = entry["storageKey"]
            parts = PurePosixPath(relative).parts
            require(parts and all(part not in (".", "..") for part in parts) and not relative.startswith("/"),
                    "unsafe restore storage key")
            source_parent = directories.pin(source + "/uploads/" + "/".join(parts[:-1]))
            destination_parent = directories.pin(operation + "/uploads/" + "/".join(parts[:-1]), create=True)
            copy_verified(source_parent, parts[-1], destination_parent, parts[-1], entry)
            expected["uploads/" + relative] = entry["bytes"], entry["sha256"]
        emit(dict(type="staged", operation=operation, uploadRoot=operation + "/uploads"))
        require(read_json().get("command") == "publish", "restore aborted before publication")
        directories.unchanged()
        actual = {"database.sqlite": None}
        db = os.open("database.sqlite", FILE_FLAGS, dir_fd=stage)
        handles.append(db)
        require(identity(os.fstat(db)) == db_identity and os.fstat(db).st_nlink == 1,
                "staged database identity changed")
        actual["database.sqlite"] = file_digest(db)
        require(identity(os.stat("uploads", dir_fd=stage, follow_symlinks=False)) ==
                identity(os.fstat(stage_uploads)), "staged uploads identity changed")
        actual.update({"uploads/" + name: value for name, value in verify_files(stage_uploads).items()})
        require(actual == expected, "staged restore file set, size or hash changed")
        move(stage, "database.sqlite", db_parent, os.path.basename(database))
        published.append("database")
        os.fsync(db_parent)
        emit(dict(type="database-published", operation=operation, uploadRoot=operation + "/uploads"))
        require(read_json().get("command") == "publish-uploads", "restore interrupted after database publication")
        directories.unchanged()
        require(identity(os.stat(os.path.basename(database), dir_fd=db_parent, follow_symlinks=False)) ==
                db_identity, "published database replaced; no cleanup performed")
        require(verify_files(stage_uploads) == {entry["storageKey"]: (entry["bytes"], entry["sha256"])
                                              for entry in request["files"]}, "uploads changed before publication")
        move(stage, "uploads", upload_parent, os.path.basename(uploads))
        published.append("uploads")
        os.fsync(upload_parent)
        directories.unchanged(ignore_prefix=operation + "/uploads")
        require(identity(os.stat(os.path.basename(database), dir_fd=db_parent, follow_symlinks=False)) ==
                db_identity, "published database identity differs")
        require(identity(os.stat(os.path.basename(uploads), dir_fd=upload_parent, follow_symlinks=False)) ==
                identity(os.fstat(stage_uploads)), "published uploads identity differs")
        require(file_digest(db) == expected["database.sqlite"], "published database bytes changed")
        emit(dict(type="complete", operation=operation, published=published))
    except BaseException as error:
        # No unlink/rmtree: publication is not a two-path transaction, and a
        # competing destination must never be removed as an attempted rollback.
        emit(dict(type="error", error=str(error), operation=operation, published=published,
                  stagingRetained=operation is not None))
        raise
    finally:
        for fd in reversed(handles):
            os.close(fd)
        directories.close()


if __name__ == "__main__":
    try:
        main()
    except BaseException as failure:
        print(type(failure).__name__ + ": " + str(failure), file=sys.stderr)
        sys.exit(1)
