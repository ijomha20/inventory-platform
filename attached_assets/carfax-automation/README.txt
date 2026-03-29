================================================================
CARFAX AUTOMATION - SETUP GUIDE
================================================================

HOW IT WORKS
------------
The script opens YOUR real Chrome browser (already logged into
Carfax), searches each VIN in your sheet, and writes the Carfax
report URL into column J automatically.

Because it uses your actual Chrome with your existing login,
it looks identical to you doing it by hand.

WHAT YOU NEED
-------------
- Node.js installed on your computer  ->  https://nodejs.org/
  (download the LTS version, install it, done)
- Google Chrome installed
- Already logged into Carfax in Chrome


================================================================
STEP 1 - Copy this folder to your computer
================================================================

Download the entire "carfax-automation" folder from this Replit
project to your computer (anywhere you like, e.g. your Desktop).


================================================================
STEP 2 - Connect it to your spreadsheet (one time only)
================================================================

This step takes about 2 minutes.

A. Paste the updated script into Apps Script
   - Open your Google Sheet
   - Extensions > Apps Script
   - Replace all code with the contents of InventorySync_v2.gs
   - Save (Ctrl+S)

B. Deploy as a Web App
   - Click "Deploy" (top right) > "New deployment"
   - Click the gear icon next to "Select type" and pick "Web app"
   - Set "Execute as" to: Me
   - Set "Who has access" to: Anyone
   - Click "Deploy"
   - Copy the Web App URL it gives you

C. Put the URL in your .env file
   - In the carfax-automation folder, copy .env.example to .env
   - Open .env and paste the Web App URL next to WEBAPP_URL=


================================================================
STEP 3 - Install dependencies (one time only)
================================================================

Open a terminal / command prompt IN the carfax-automation folder
and run:

    npm install

Then install the Playwright browser:

    npx playwright install chromium


================================================================
STEP 4 - Run it
================================================================

In the same terminal, run:

    node carfax-sync.js

Chrome will open, search each VIN, and results appear in column J
as each one is found. VINs with no Carfax report get "NOT FOUND"
so they are skipped on future runs.


================================================================
TIPS
================================================================
- Close all Chrome windows before running for best results.
- If Chrome fails to open, try setting CHROME_PROFILE_PATH in .env.
- Screenshots of any errors are saved in the screenshots/ folder.
- You can run the script again any time — it only processes rows
  where column J is still empty.
- To retry "NOT FOUND" rows, just clear the cell in column J and
  run again.
================================================================
