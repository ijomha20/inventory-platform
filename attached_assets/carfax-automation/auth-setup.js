// ================================================================
// CARFAX AUTOMATION - ONE-TIME GOOGLE SHEETS AUTH SETUP
// Run this once: node auth-setup.js
// It will open your browser, ask you to authorize Google Sheets
// access, and save a token.json file for future runs.
// ================================================================

var fs   = require('fs');
var path = require('path');
var http = require('http');
var url  = require('url');

require('dotenv').config();

var { google } = require('googleapis');

var SCOPES           = ['https://www.googleapis.com/auth/spreadsheets'];
var CREDENTIALS_FILE = path.join(__dirname, 'credentials.json');
var TOKEN_FILE       = path.join(__dirname, 'token.json');

function main() {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    console.log('');
    console.log('ERROR: credentials.json not found.');
    console.log('');
    console.log('Follow these steps to get it:');
    console.log('  1. Go to: https://console.cloud.google.com/');
    console.log('  2. Create a new project (name it anything).');
    console.log('  3. Go to "APIs & Services" > "Enable APIs" and enable "Google Sheets API".');
    console.log('  4. Go to "APIs & Services" > "Credentials".');
    console.log('  5. Click "Create Credentials" > "OAuth 2.0 Client IDs".');
    console.log('  6. Application type: "Desktop app". Name it anything. Click Create.');
    console.log('  7. Download the JSON file.');
    console.log('  8. Rename it to credentials.json and place it in this folder.');
    console.log('  9. Run this script again.');
    console.log('');
    process.exit(1);
  }

  var raw = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
  var credentials = JSON.parse(raw);
  var clientInfo = credentials.installed || credentials.web;

  var oAuth2Client = new google.auth.OAuth2(
    clientInfo.client_id,
    clientInfo.client_secret,
    'http://localhost:3456'
  );

  var authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });

  console.log('');
  console.log('Opening your browser for Google authorization...');
  console.log('If the browser does not open, paste this URL manually:');
  console.log('');
  console.log(authUrl);
  console.log('');

  var openPkg = require('open');
  (typeof openPkg === 'function' ? Promise.resolve(openPkg) : Promise.resolve(openPkg.default || openPkg))
    .then(function(open) { return open(authUrl); })
    .catch(function() {});

  var server = http.createServer(function(req, res) {
    var parsed = url.parse(req.url, true);
    var code   = parsed.query.code;

    if (!code) {
      res.end('No authorization code received. Please try again.');
      return;
    }

    res.end('<h2>Authorization successful! You can close this tab.</h2>');
    server.close();

    oAuth2Client.getToken(code, function(err, token) {
      if (err) {
        console.log('ERROR getting token:', err.message);
        process.exit(1);
      }
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2));
      console.log('');
      console.log('SUCCESS. token.json saved.');
      console.log('You are now authorized. Run "node carfax-sync.js" to start.');
      console.log('');
      process.exit(0);
    });
  });

  server.listen(3456, function() {
    console.log('Waiting for authorization on http://localhost:3456 ...');
  });
}

main();
