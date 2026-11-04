#!/usr/bin/env python3
"""Sealed root read-only bridge. Fixed source names, sanitized output only."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys
import time


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',choices=['monitor','access','journal'],required=True)
    parser.add_argument('--cursor-json')
    args=parser.parse_args()
    if os.geteuid()!=0:
        print('{"status":"FAIL","code":"ROOT_BRIDGE_REQUIRED"}');return 1
    code=Path(__file__).absolute().with_name('nuaafa_monitoring.py')
    for path in [Path(__file__).absolute(),code,*code.parents]:
        st=path.lstat()
        if path.is_symlink() or st.st_uid!=0 or st.st_mode&0o022:
            print('{"status":"FAIL","code":"UNTRUSTED_BRIDGE_CODE"}');return 1
    try:
        if args.cursor_json and len(args.cursor_json)>8192:raise ValueError()
        cursor=json.loads(args.cursor_json) if args.cursor_json else None
        spec=importlib.util.spec_from_file_location('sealed_monitoring',code)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        value=module.read_fixed_input(args.source,cursor,time.time())
        print(module.canonical(value));return 0
    except Exception:
        print('{"status":"FAIL","code":"FIXED_INPUT_UNAVAILABLE"}');return 1


if __name__=='__main__':sys.exit(main())
