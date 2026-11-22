#!/usr/bin/env python3
# Copyright (c) Freelens Authors. All rights reserved.
# Licensed under MIT License. See LICENSE in root directory for more information.
"""RSS of a macOS application and of every process it is responsible for.

WKWebView's helpers (WebContent, Networking, GPU) are started by launchd, not
by the application, so a parent-pid walk misses them; their responsible pid is
the application's (research R7). RSS is printed in the unit of
specs/measure-baseline.sh: the KiB of ps divided by 1024.

usage: python3 -I responsible-rss.py <pid>
"""

import ctypes
import subprocess
import sys


def main() -> None:
    target = int(sys.argv[1])
    quarantine = ctypes.CDLL("/usr/lib/system/libquarantine.dylib")
    responsible = quarantine.responsibility_get_pid_responsible_for_pid
    responsible.argtypes = [ctypes.c_int]
    responsible.restype = ctypes.c_int

    listing = subprocess.run(
        ["ps", "-A", "-o", "pid=,rss=,comm="], capture_output=True, text=True, check=True
    ).stdout
    total_kib = 0
    for line in listing.splitlines():
        pid_text, rss_text, command = line.split(None, 2)
        pid, rss_kib = int(pid_text), int(rss_text)
        if pid == target or responsible(pid) == target:
            total_kib += rss_kib
            print(f"proc={pid} {command.rsplit('/', 1)[-1]} {rss_kib / 1024:.0f}")
    print(f"rss_mb={total_kib / 1024:.0f}")


if __name__ == "__main__":
    main()
