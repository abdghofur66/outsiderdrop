#!/bin/bash
# Buka server OutsiderDrop di jendela Terminal (tutup jendela itu untuk berhenti), seperti exe di Windows.
DIR="$(cd "$(dirname "$0")" && pwd)"
open -a Terminal "$DIR/outsiderdrop-server"
