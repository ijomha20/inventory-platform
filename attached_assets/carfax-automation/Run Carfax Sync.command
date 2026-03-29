#!/bin/bash
cd "$(dirname "$0")"
echo ""
echo " CARFAX AUTOMATION v1.3"
echo ""
echo " 1. Run once  (process current VINs and exit)"
echo " 2. Watch mode (keep running, auto-checks every 5 min for new VINs)"
echo ""
read -p "Enter 1 or 2: " choice
echo ""
if [ "$choice" = "2" ]; then
  node carfax-sync.js --watch
else
  node carfax-sync.js
fi
