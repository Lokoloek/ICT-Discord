// BOVENAAN:
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

// --- CONSTANTEN ---
const CALENDAR_URL = 'https://www.forexfactory.com/calendar?day=today'; // GEWIJZIGD om "vandaag" te tonen
const LOGIN_URL = 'https://www.forexfactory.com/login';
const PROFILE_URL = 'https://www.forexfactory.com/lokoloek';

const USERNAME_SELECTOR = '#login_username';
const PASSWORD_SELECTOR = '#login_password';
const LOGIN_BUTTON_SELECTOR = 'input[type="submit"].button';
const LOGIN_SUCCESS_SELECTOR = 'a.logout';

const SCREENSHOT_PATH = 'forex_calendar.png';
const DEBUG_SCREENSHOT_PATH = 'debug_screenshot.png';
const LOGIN_FAILED_SCREENSHOT_PATH = 'login_failed_debug.png';
const ERROR_SCREENSHOT_PATH = 'error_screenshot.png';

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const FOREX_USER = process.env.FOREX_FACTORY_USER;
const FOREX_PASS = process.env.FOREX_FACTORY_PASS;
// --- EINDE CONSTANTEN ---

async function takeScreenshot() {
    if (!FOREX_USER || !FOREX_PASS) {
        console.error('Forex Factory username or password not set in GitHub Secrets (FOREX_FACTORY_USER, FOREX_FACTORY_PASS).');
        throw new Error('Missing login credentials.');
    }

    console.log('Launching stealth browser with refined options...');
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36';

    let browser = null;
    let page = null;

    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox', '--disable-setuid-sandbox', '--disable-infobars',
                '--window-position=0,0', '--ignore-certificate-errors',
                '--ignore-certificate-errors-spki-list', `--user-agent=${userAgent}`,
                '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas',
                '--disable-gpu', '--window-size=1920,1080', // Breedte is belangrijk voor layout
                '--lang=en-US,en;q=0.9', '--accept-language=en-US,en;q=0.9',
            ],
            ignoreDefaultArgs: ['--enable-automation'],
        });

        page = await browser.newPage();
        await page.setUserAgent(userAgent);
        await page.setViewport({ width: 1920, height: 1080 }); // Viewport grootte
        await page.setExtraHTTPHeaders({'accept-language': 'en-US,en;q=0.9'});

        // --- LOGIN STAP ---
        // (Dit deel blijft ongewijzigd en werkte al)
        console.log(`Navigating to login page: ${LOGIN_URL}`);
        await page.goto(LOGIN_URL, { waitUntil: 'networkidle0', timeout: 60000 });
        console.log('Waiting for login form elements...');
        await page.waitForSelector(USERNAME_SELECTOR, { timeout: 30000, visible: true });
        await page.waitForSelector(PASSWORD_SELECTOR, { timeout: 30000, visible: true });
        await page.waitForSelector(LOGIN_BUTTON_SELECTOR, { timeout: 30000, visible: true });
        console.log('Typing username...');
        await page.type(USERNAME_SELECTOR, FOREX_USER);
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log('Typing password...');
        await page.type(PASSWORD_SELECTOR, FOREX_PASS);
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log('Clicking login button...');
        await Promise.all([
            page.click(LOGIN_BUTTON_SELECTOR),
            page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 })
        ]);
        console.log(`Landed on ${page.url()} after login click.`);
        console.log(`Navigating to profile page: ${PROFILE_URL}`);
        await page.goto(PROFILE_URL, { waitUntil: 'networkidle0', timeout: 60000 });
        console.log(`Current URL is now: ${page.url()}`);
        if (LOGIN_SUCCESS_SELECTOR) {
            try {
                console.log(`Verifying login on profile page by waiting for selector: ${LOGIN_SUCCESS_SELECTOR}`);
                await page.waitForSelector(LOGIN_SUCCESS_SELECTOR, { timeout: 30000, visible: true });
                console.log('Login successful! (Success selector found on profile page)');
            } catch (e) {
                console.warn(`Login success selector "${LOGIN_SUCCESS_SELECTOR}" not found on profile page (${PROFILE_URL}). Original error: ${e.message}.`);
                try {
                    console.log(`Attempting to save screenshot to ${LOGIN_FAILED_SCREENSHOT_PATH}...`);
                    await page.screenshot({ path: LOGIN_FAILED_SCREENSHOT_PATH, fullPage: true });
                    console.log(`Screenshot successfully saved to ${LOGIN_FAILED_SCREENSHOT_PATH}`);
                } catch (screenshotError) {
                    console.error(`FAILED to save ${LOGIN_FAILED_SCREENSHOT_PATH}. Screenshot error: ${screenshotError.message}`);
                }
                throw new Error(`Failed to verify login on profile page (selector "${LOGIN_SUCCESS_SELECTOR}" not found). Original waitForSelector error: ${e.message}`);
            }
        } else {
            console.log('No login success selector provided, assuming login worked based on navigation to profile page.');
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        // --- EINDE LOGIN STAP ---

        console.log(`Navigating to calendar page (today view): ${CALENDAR_URL}...`);
        await page.goto(CALENDAR_URL, { waitUntil: 'networkidle0', timeout: 90000 });
        console.log(`Current URL is now: ${page.url()}`);

        // --- VERWIJDER STORENDE ELEMENTEN ---
        try {
            console.log('Attempting to remove distracting elements for a cleaner screenshot...');
            await page.evaluate(() => {
                const selectorsToRemove = [
                    '#header',                     // Website header
                    '#footer_wrapper',             // Website footer
                    'div.calendar__control.left',  // Linker navigatiekolom met datums etc.
                    '#adblock_whitelist_pitch',    // Adblocker whitelist verzoek
                    '.calendarsite__speedbump',    // "Are you a professional trader" popup
                    '.ff-ad',                      // Algemene advertentie class
                    'iframe[id^="google_ads_iframe"]', // Google advertentie iframes
                    '.no-print'                    // Elementen die niet geprint moeten worden (soms overbodig)
                ];
                selectorsToRemove.forEach(selector => {
                    document.querySelectorAll(selector).forEach(el => el.remove());
                });
                // Pas body stijlen aan voor minimale witruimte
                document.body.style.padding = '0px';
                document.body.style.margin = '0px';
                document.body.style.background = 'white'; // Maak achtergrond wit
                // Centreer de hoofd content als die er is
                const mainContent = document.querySelector('#content .flexBox_flex_calendar_mainCal') || document.querySelector('#content');
                if(mainContent && mainContent.parentElement){
                    mainContent.parentElement.style.width = '100%'; // Zorg dat parent breed genoeg is
                }
                if (mainContent) {
                    mainContent.style.margin = '0 auto'; // Centreer de kalender
                    mainContent.style.padding = '10px'; // Kleine padding voor de kalender zelf
                    mainContent.style.maxWidth = '1000px'; // Maximale breedte voor de kalender
                }
            });
            console.log('Distracting elements removed.');
            await new Promise(resolve => setTimeout(resolve, 500)); // Geef DOM even tijd
        } catch (evalError) {
            console.warn('Could not remove all distracting elements:', evalError.message);
        }
        // --- EINDE VERWIJDER STORENDE ELEMENTEN ---

        console.log('Calendar page modified. Checking for main content data...');
        const mainCalendarContentSelector = 'tr.calendar__row--new-day';

        try {
            console.log(`Waiting for calendar content selector "${mainCalendarContentSelector}" to appear...`);
            await page.waitForSelector(mainCalendarContentSelector, { timeout: 60000, visible: true });
            console.log('Main calendar content (first day row) loaded. Proceeding to screenshot.');
        } catch (error) {
            console.error(`Timeout or error waiting for calendar selector "${mainCalendarContentSelector}" on page ${page.url()}. Original error: ${error.message}.`);
            try {
                console.log(`Attempting to save screenshot to ${DEBUG_SCREENSHOT_PATH}...`);
                await page.screenshot({ path: DEBUG_SCREENSHOT_PATH, fullPage: true });
                console.log(`Screenshot successfully saved to ${DEBUG_SCREENSHOT_PATH}.`);
            } catch (screenshotError) {
                console.error(`FAILED to save ${DEBUG_SCREENSHOT_PATH}. Screenshot error: ${screenshotError.message}`);
            }
            throw error;
        }

        console.log('Taking FINAL screenshot of the cleaned calendar page...');
        // Maak een screenshot van de hele pagina. Door elementen te verwijderen,
        // zal dit effectief neerkomen op de kalender zelf.
        await page.screenshot({ 
            path: SCREENSHOT_PATH, 
            fullPage: true 
        });

        console.log(`FINAL Screenshot saved to ${SCREENSHOT_PATH}`);

    } catch (error) {
        console.error('General error during screenshot process:', error.message);
        if (page && !page.isClosed() &&
            !fs.existsSync(DEBUG_SCREENSHOT_PATH) &&
            !fs.existsSync(LOGIN_FAILED_SCREENSHOT_PATH) &&
            !fs.existsSync(SCREENSHOT_PATH)) {
            try {
                console.log(`Attempting to save general error screenshot to ${ERROR_SCREENSHOT_PATH}...`);
                await page.screenshot({ path: ERROR_SCREENSHOT_PATH, fullPage: true });
                console.log(`General error screenshot saved as ${ERROR_SCREENSHOT_PATH}`);
            } catch (ssError) {
                console.error(`FAILED to save general error screenshot ${ERROR_SCREENSHOT_PATH}. Screenshot error: ${ssError.message}`);
            }
        }
        throw error;
    } finally {
        if (browser) {
            await browser.close();
            console.log('Browser closed.');
        } else {
            console.log('Browser was not launched or already closed in finally.');
        }
    }
}

// De sendToDiscord en main functies blijven hetzelfde als in de vorige versie (die DEBUG_SCREENSHOT_PATH stuurt als SCREENSHOT_PATH mist)
async function sendFileToDiscord(filePath, fileName, title) {
    const formData = new FormData();
    formData.append('file1', fs.createReadStream(filePath), {
        filename: fileName,
        contentType: 'image/png',
    });
    formData.append('payload_json', JSON.stringify({
        content: title
    }));

    try {
        const response = await axios.post(DISCORD_WEBHOOK_URL, formData, {
            headers: formData.getHeaders(),
        });
        console.log(`Successfully sent ${fileName} to Discord:`, response.status);
    } catch (error) {
        console.error(`Error sending ${fileName} to Discord:`);
        if (error.response) {
            console.error('Data:', error.response.data);
            console.error('Status:', error.response.status);
            console.error('Headers:', error.response.headers);
        } else if (error.request) {
            console.error('Request:', error.request);
        } else {
            console.error('Error Message:', error.message);
        }
    }
}

async function sendToDiscord() {
    if (!DISCORD_WEBHOOK_URL) {
        console.error('DISCORD_WEBHOOK_URL is not set.');
        return;
    }
    if (fs.existsSync(SCREENSHOT_PATH)) {
        console.log(`Sending ${SCREENSHOT_PATH} to Discord...`);
        await sendFileToDiscord(SCREENSHOT_PATH, 'forex_calendar.png', `📅 **Forex Factory Calendar - ${new Date().toDateString()}**`);
    } 
    else if (fs.existsSync(DEBUG_SCREENSHOT_PATH)) {
        console.warn(`${SCREENSHOT_PATH} not found. Attempting to send ${DEBUG_SCREENSHOT_PATH} instead.`);
        await sendFileToDiscord(DEBUG_SCREENSHOT_PATH, 'forex_calendar_debug.png', `⚠️ **DEBUG: Forex Factory Calendar (Selector Failed) - ${new Date().toDateString()}**`);
    } 
    else {
        console.warn(`Neither ${SCREENSHOT_PATH} nor ${DEBUG_SCREENSHOT_PATH} found. Not sending to Discord.`);
    }
}

async function main() {
    try {
        await takeScreenshot();
        await sendToDiscord();
    } catch (error) {
        console.error('Script failed in main:', error.message);
        process.exit(1);
    }
}

main();
