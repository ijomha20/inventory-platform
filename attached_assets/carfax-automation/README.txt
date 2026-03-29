================================================================
CARFAX AUTOMATION - SETUP GUIDE
================================================================

HOW IT WORKS
------------
This script opens YOUR real Chrome browser (already logged into
Carfax), searches each VIN in your "My List" sheet, and writes
the Carfax report URL directly into column J.

Because it uses your actual Chrome profile with your existing
login session, it is indistinguishable from you doing it manually.

REQUIREMENTS
------------
- Node.js installed on your computer (https://nodejs.org/)
- Google Chrome installed (not Chromium)
- Logged into Carfax in Chrome already
- The "My List" sheet updated to include a "Carfax" header in J1
  (run firstTimeSetup in Apps Script to add it)


STEP 1 - Install dependencies
------------------------------
Open a terminal/command prompt in this folder and run:

    npm install


STEP 2 - Create your .env file
--------------------------------
1. Copy .env.example to .env
2. Open .env and fill in:
   - SPREADSHEET_ID  (from your sheet's URL)
   - SHEET_NAME      (usually "My List")
   - CHROME_PROFILE_PATH (leave blank to auto-detect)


STEP 3 - Set up Google Sheets access (one time only)
------------------------------------------------------
1. Go to https://console.cloud.google.com/
2. Create a new project (any name).
3. Go to "APIs & Services" > "Library" and search for
   "Google Sheets API". Click it and enable it.
4. Go to "APIs & Services" > "Credentials".
5. Click "Create Credentials" > "OAuth 2.0 Client IDs".
6. Application type: "Desktop app". Click Create.
7. Download the JSON file.
8. Rename it to credentials.json and put it in THIS folder.
9. Run in terminal:

    node auth-setup.js

   Your browser will open. Log in with your Google account and
   authorize the app. A token.json file will be saved. Done.


STEP 4 - Run
-------------
    node carfax-sync.js

Chrome will open automatically and search each VIN.
Results are written to column J as each VIN is processed.
Rows marked "NOT FOUND" will not be retried on the next run.
Rows that errored (Chrome issue, etc.) are left blank and
will be retried next time you run the script.


TIPS
-----
- Close all other Chrome windows before running for best results.
- If Chrome fails to open, set CHROME_PROFILE_PATH manually in .env.
- Screenshots of any errors are saved in the screenshots/ folder.
- If Carfax changes their layout and the script stops finding results,
  check screenshots/ to see what the page looks like, then update the
  SELECTORS section at the top of carfax-sync.js.
- Increase DELAY_BETWEEN_VINS in .env if you want slower, more
  cautious pacing (default is 3 seconds between each VIN).


TROUBLE?
---------
1. Make sure you are already logged into Carfax in Chrome.
2. Close all Chrome windows, then run the script again.
3. Check the screenshots/ folder for captured error pages.
4. Make sure your .env file has the correct SPREADSHEET_ID.

================================================================
