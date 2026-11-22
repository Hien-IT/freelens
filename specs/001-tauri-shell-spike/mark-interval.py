#!/usr/bin/env python3
# Copyright (c) Freelens Authors. All rights reserved.
# Licensed under MIT License. See LICENSE in root directory for more information.
"""Seconds between two marks of a log as it is written (contracts/log-lines.md).

Reads the log every millisecond and prints the interval, to the millisecond,
between the first `Mark "<first>"` and the first `Mark "<second>"`. Exits 1
when the second mark does not come within 60 seconds.

usage: python3 -I mark-interval.py <log> <first mark> <second mark>
"""

import sys
import time


def main() -> None:
    path, first, second = sys.argv[1:4]
    wanted = [f'Mark "{first}"', f'Mark "{second}"']
    seen: dict[str, float] = {}
    text = ""
    deadline = time.monotonic() + 60
    with open(path, encoding="utf-8") as log:
        while time.monotonic() < deadline:
            chunk = log.read()
            if not chunk:
                time.sleep(0.001)
                continue
            now = time.monotonic()
            text += chunk
            for line in wanted:
                if line in text and line not in seen:
                    seen[line] = now
            if len(seen) == 2:
                print(f"{seen[wanted[1]] - seen[wanted[0]]:.3f}")
                return
    sys.exit(1)


if __name__ == "__main__":
    main()
