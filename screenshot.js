// BOVENAAN:
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

// --- CONSTANTEN ---
const CALENDAR_URL = 'https://www.forexfactory.com/calendar?day=today';
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
                '--disable-gpu', '--window-size=1920,1080',
                '--lang=en-US,en;q=0.9', '--accept-language=en-US,en;q=0.9',
            ],
            ignoreDefaultArgs: ['--enable-automation'],
        });

        page = await browser.newPage();
        await page.setUserAgent(userAgent);
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setExtraHTTPHeaders({'accept-language': 'en-US,en;q=0.9'});

        // --- LOGIN STAP ---
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

        console.log('Calendar page loaded. Waiting for calendar data to be present...');
        const calendarDataLoadedSelector = 'tr.calendar__row--new-day';

        try {
            console.log(`Waiting for calendar data selector "${calendarDataLoadedSelector}" to appear...`);
            await page.waitForSelector(calendarDataLoadedSelector, { timeout: 60000, visible: true });
            console.log('Main calendar data (first day row) loaded.');
        } catch (error) {
            console.error(`Timeout or error waiting for initial calendar data selector "${calendarDataLoadedSelector}" on page ${page.url()}. Original error: ${error.message}.`);
            await page.screenshot({ path: DEBUG_SCREENSHOT_PATH, fullPage: true });
            console.log(`Debug screenshot (data not loaded) saved to ${DEBUG_SCREENSHOT_PATH}.`);
            throw error;
        }

        // --- VERWIJDER STORENDE ELEMENTEN ---
        try {
            console.log('Attempting to remove/hide distracting elements for a cleaner screenshot...');
            await page.evaluate(() => {
                const selectorsToHideOrRemove = [
                    '#header', '#footer_wrapper', 'div.calendar__control.left',
                    '#adblock_whitelist_pitch', '.calendarsite__speedbump',
                    '.ff-ad', 'iframe[id^="google_ads_iframe"]', '.no-print',
                    '.thread Índex', '.pagetitle', '.content_tabs',
                    '#content > .sidebar', '.calendar__options'
                ];
                selectorsToHideOrRemove.forEach(selector => {
                    document.querySelectorAll(selector).forEach(el => el.style.display = 'none');
                });
                document.body.style.padding = '0px';
                document.body.style.margin = '0px';
                document.body.style.background = 'white';
                
                const calendarContainer = document.getElementById('flexBox_flex_calendar_mainCal');
                if (calendarContainer) {
                    calendarContainer.style.margin = '0';
                    calendarContainer.style.padding = '5px';
                    calendarContainer.style.border = 'none';
                    calendarContainer.style.display = 'block';
                    calendarContainer.style.visibility = 'visible';
                }
                window.scrollTo(0,0);
            });
            console.log('Distracting elements hidden.');
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (evalError) {
            console.warn('Could not hide all distracting elements:', evalError.message);
        }
        // --- EINDE VERWIJDER STORENDE ELEMENTEN ---

        // --- SCREENSHOT NEMEN VAN HET BODY ELEMENT ---
        console.log('Attempting to take screenshot of the BODY after cleaning...');
        try {
            // ***** BEGIN GEWIJZIGD BLOK *****
            const bodyElement = await page.$('body'); // Selecteer het body element
            if (bodyElement) {
                console.log('Body element found. Taking element screenshot of body...');
                await bodyElement.screenshot({
                    path: SCREENSHOT_PATH
                });
                console.log(`Element screenshot of body saved to ${SCREENSHOT_PATH}`);
            } else {
                console.error('Body element not found for screenshot. Taking full page debug screenshot instead.');
                await page.screenshot({ path: DEBUG_SCREENSHOT_PATH, fullPage: true });
                throw new Error('Could not find body element to screenshot.');
            }
            // ***** EINDE GEWIJZIGD BLOK *****
        } catch (screenshotError) {
            console.error(`Error taking element screenshot of body: ${screenshotError.message}`);
            if (!fs.existsSync(DEBUG_SCREENSHOT_PATH) && page && !page.isClosed()) {
                 await page.screenshot({ path: DEBUG_SCREENSHOT_PATH, fullPage: true });
            }
            throw screenshotError;
        }
        // --- EINDE SCREENSHOT NEMEN ---

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

// De sendToDiscord en main functies blijven hetzelfde
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
