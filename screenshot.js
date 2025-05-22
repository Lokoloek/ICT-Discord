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
const PROFILE_URL = 'https://www.forexfactory.com/lo3k'; // Jouw bevestigde profielpagina URL

const USERNAME_SELECTOR = '#login_username';
const PASSWORD_SELECTOR = '#login_password';
const LOGIN_BUTTON_SELECTOR = 'input[type="submit"].button';
// const LOGIN_SUCCESS_SELECTOR = 'a.logout'; // We gebruiken dit niet meer actief

const SCREENSHOT_PATH = 'forex_calendar.png';
const DEBUG_SCREENSHOT_PATH = 'debug_screenshot.png';
const LOGIN_FAILED_SCREENSHOT_PATH = 'login_failed_debug.png'; // Wordt nu minder waarschijnlijk
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
                '--disable-gpu', '--window-size=1920,1200', 
                '--lang=en-US,en;q=0.9', '--accept-language=en-US,en;q=0.9',
            ],
            ignoreDefaultArgs: ['--enable-automation'],
        });

        page = await browser.newPage();
        await page.setUserAgent(userAgent);
        await page.setViewport({ width: 1200, height: 1200 }); 
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
        // We gaan er vanuit dat de login succesvol was (gezien eerdere email notificatie).
        // De profielpagina check wordt overgeslagen omdat het een 404 gaf.
        console.log(`Landed on ${page.url()} after login click. Proceeding as if login was successful.`);
        // --- EINDE LOGIN STAP (VEREENVOUDIGD) ---

        console.log(`Navigating directly to calendar page (today view): ${CALENDAR_URL}...`);
        await page.goto(CALENDAR_URL, { waitUntil: 'networkidle0', timeout: 90000 });
        console.log(`Current URL is now: ${page.url()}`);

        console.log('Calendar page loaded. Waiting for calendar data to be present...');
        const calendarDataLoadedSelector = 'tr.calendar__row--new-day';
        try {
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
            console.log('Attempting to REMOVE distracting elements...');
            await page.evaluate(() => {
                const selectorsToRemove = [
                    '#header', '#footer_wrapper', 'div.calendar__control.left',
                    '.calendar__options',
                    '.calendar__status', 'div.calendar__more', 'div.calendar__timezone',
                    '#adblock_whitelist_pitch', '.calendarsite__speedbump', '.ff-ad',
                    'iframe[id^="google_ads_iframe"]', '.no-print', '.pagetitle',
                    '.content_tabs', '#content > .sidebar'
                ];
                selectorsToRemove.forEach(selector => {
                    document.querySelectorAll(selector).forEach(el => el.remove());
                });
                document.body.style.padding = '0px';
                document.body.style.margin = '0px';
                document.body.style.background = 'white';
                // document.body.style.overflow = 'hidden'; // Uitgecommentarieerd
                const calendarContainer = document.getElementById('flexBox_flex_calendar_mainCal');
                if (calendarContainer) {
                    calendarContainer.style.margin = '0'; 
                    calendarContainer.style.padding = '5px'; 
                    calendarContainer.style.border = 'none';
                    calendarContainer.style.boxShadow = 'none';
                }
                window.scrollTo(0,0);
            });
            console.log('Distracting elements REMOVED.');
            await new Promise(resolve => setTimeout(resolve, 2500));
        } catch (evalError) {
            console.warn('Could not remove all distracting elements:', evalError.message);
        }
        
        // ***** SCREENSHOT BLOK MET DYNAMISCHE HOOGTE CLIP *****
        console.log('Attempting to take a CLIPPED screenshot based on calendar element height...');
        try {
            const calendarElementSelector = '#flexBox_flex_calendar_mainCal';
            const calendarElementHandle = await page.$(calendarElementSelector);

            if (calendarElementHandle) {
                const boundingBox = await calendarElementHandle.boundingBox();
                if (boundingBox && boundingBox.height > 0) {
                    const desiredWidth = 1050;
                    let clipX = Math.floor(boundingBox.x);
                    let clipWidth = desiredWidth;
                    if (boundingBox.width < desiredWidth) {
                        clipWidth = Math.ceil(boundingBox.width);
                    }
                    if ((clipX + clipWidth) > (boundingBox.x + boundingBox.width)) {
                        clipX = Math.max(0, Math.floor(boundingBox.x + boundingBox.width - clipWidth) );
                    }
                    let clipHeight = Math.ceil(boundingBox.height);
                    console.log(`Calendar element dimensions: x=${boundingBox.x}, y=${boundingBox.y}, width=${boundingBox.width}, height=${boundingBox.height}`);
                    console.log(`Clipping at: x=${clipX}, y=${Math.floor(boundingBox.y)}, width=${clipWidth}, height=${clipHeight}`);
                    const requiredViewportWidth = clipX + clipWidth + 20;
                    const requiredViewportHeight = Math.floor(boundingBox.y) + clipHeight + 20;
                    const currentViewport = page.viewport();
                    if (currentViewport.width < requiredViewportWidth || currentViewport.height < requiredViewportHeight) {
                        console.log(`Adjusting viewport to ${requiredViewportWidth}x${requiredViewportHeight} for clip.`);
                        await page.setViewport({ 
                            width: Math.max(currentViewport.width, requiredViewportWidth), 
                            height: Math.max(currentViewport.height, requiredViewportHeight)
                        });
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                    await page.screenshot({
                        path: SCREENSHOT_PATH,
                        clip: { x: clipX, y: Math.floor(boundingBox.y), width: clipWidth, height: clipHeight }
                    });
                    console.log(`Clipped screenshot saved to ${SCREENSHOT_PATH}`);
                } else {
                    console.error('Could not get valid bounding box for calendar element or height is 0. Taking full page debug screenshot.');
                    await page.screenshot({ path: DEBUG_SCREENSHOT_PATH, fullPage: true });
                    throw new Error('Calendar element bounding box was null or height was 0.');
                }
            } else {
                console.error(`Calendar element "${calendarElementSelector}" not found. Taking full page debug screenshot.`);
                await page.screenshot({ path: DEBUG_SCREENSHOT_PATH, fullPage: true });
                throw new Error(`Could not find element ${calendarElementSelector} to screenshot.`);
            }
        } catch (screenshotError) {
            console.error(`Error taking clipped screenshot: ${screenshotError.message}`);
            if (!fs.existsSync(DEBUG_SCREENSHOT_PATH) && page && !page.isClosed()) {
                 await page.screenshot({ path: DEBUG_SCREENSHOT_PATH, fullPage: true });
                 console.log(`Fallback debug screenshot saved to ${DEBUG_SCREENSHOT_PATH}`);
            }
            throw screenshotError;
        }
        // ***** EINDE SCREENSHOT BLOK *****

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
        await sendFileToDiscord(DEBUG_SCREENSHOT_PATH, 'forex_calendar_debug.png', `⚠️ **DEBUG: Forex Factory Calendar (Content/Clip Issue) - ${new Date().toDateString()}**`);
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
