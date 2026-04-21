#!/bin/bash
cd "$(dirname "$0")"
python3 pipelines/bulk_indexer.py "$@"
