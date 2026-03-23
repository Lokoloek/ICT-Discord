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

const USERNAME_SELECTOR = 'input[name="vb_login_username"]';
const PASSWORD_SELECTOR = 'input[name="vb_login_password"]';

const SCREENSHOT_PATH = 'forex_calendar.png';
const DEBUG_SCREENSHOT_PATH = 'debug_screenshot.png'; 
const ERROR_SCREENSHOT_PATH = 'error_screenshot.png';

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const FOREX_USER = process.env.FOREX_FACTORY_USER;
const FOREX_PASS = process.env.FOREX_FACTORY_PASS;
// --- EINDE CONSTANTEN ---

async function takeScreenshot() {
    if (!FOREX_USER || !FOREX_PASS) {
        console.error('Forex Factory username or password not set in GitHub Secrets.');
        throw new Error('Missing login credentials.');
    }

    console.log('Launching stealth browser...');
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
        
        await page.waitForSelector(USERNAME_SELECTOR, { timeout: 30000 });
        await page.waitForSelector(PASSWORD_SELECTOR, { timeout: 30000 });
        
        console.log('Typing username...');
        const userFields = await page.$$(USERNAME_SELECTOR);
        for (const field of userFields) {
            const isVisible = await field.evaluate(el => el.offsetWidth > 0 && el.offsetHeight > 0);
            if (isVisible) {
                await field.type(FOREX_USER);
                break;
            }
        }
        await new Promise(resolve => setTimeout(resolve, 500));
        
        console.log('Typing password...');
        const passFields = await page.$$(PASSWORD_SELECTOR);
        for (const field of passFields) {
            const isVisible = await field.evaluate(el => el.offsetWidth > 0 && el.offsetHeight > 0);
            if (isVisible) {
                await field.type(FOREX_PASS);
                break;
            }
        }
        await new Promise(resolve => setTimeout(resolve, 500));
        
        console.log('Pressing Enter to login...');
        await Promise.all([
            page.keyboard.press('Enter'),
            page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 })
        ]);
        // --- EINDE LOGIN STAP ---

        console.log(`Navigating to calendar page: ${CALENDAR_URL}...`);
        await page.goto(CALENDAR_URL, { waitUntil: 'networkidle0', timeout: 90000 });

        console.log('Calendar page loaded. Waiting for calendar data...');
        const calendarDataLoadedSelector = 'tr.calendar__row--new-day';
        try {
            await page.waitForSelector(calendarDataLoadedSelector, { timeout: 60000, visible: true });
        } catch (error) {
            console.error(`Timeout waiting for calendar data: ${error.message}.`);
            await page.screenshot({ path: DEBUG_SCREENSHOT_PATH, fullPage: true });
            throw error; 
        }

        // --- VERWIJDER STORENDE ELEMENTEN ---
        try {
            console.log('Attempting to REMOVE distracting elements...');
            await page.evaluate(() => {
                // AANGEPAST: Agressievere selectors voor headers en footers
                const selectorsToRemove = [
                    'header', '.header', '#header', 
                    'footer', '.footer', '#footer_wrapper', '#footer',
                    'div.calendar__control.left', '.calendar__options', 
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
                window.scrollTo(0,0);
            });
            await new Promise(resolve => setTimeout(resolve, 2500));
        } catch (evalError) {
            console.warn('Could not remove all distracting elements:', evalError.message);
        }
        
        // ***** BEGIN SCREENSHOT BLOK *****
        console.log('Attempting to take final clipped screenshot...');
        try {
            // AANGEPAST: Zoek naar de daadwerkelijke kalender tabel in plaats van een verdwenen ID
            const calendarElementSelector = '.calendar__table'; 
            const calendarElementHandle = await page.$(calendarElementSelector);

            if (calendarElementHandle) {
                const boundingBox = await calendarElementHandle.boundingBox();
                if (boundingBox && boundingBox.height > 0) {
                    const desiredWidth = 1050;
                    let clipX = Math.floor(boundingBox.x);
                    let clipWidth = desiredWidth;
                    if (boundingBox.width < desiredWidth) clipWidth = Math.ceil(boundingBox.width);
                    if ((clipX + clipWidth) > (boundingBox.x + boundingBox.width)) clipX = Math.max(0, Math.floor(boundingBox.x + boundingBox.width - clipWidth));
                    
                    // Voeg 20 pixels extra marge toe aan de onderkant zodat randen niet afgeknipt worden
                    let clipHeight = Math.ceil(boundingBox.height) + 20; 
                    
                    const requiredViewportWidth = clipX + clipWidth + 20;
                    const requiredViewportHeight = Math.floor(boundingBox.y) + clipHeight + 20;
                    const currentViewport = page.viewport();
                    
                    if (currentViewport.width < requiredViewportWidth || currentViewport.height < requiredViewportHeight) {
                        await page.setViewport({ width: Math.max(currentViewport.width, requiredViewportWidth), height: Math.max(currentViewport.height, requiredViewportHeight) });
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                    
                    await page.screenshot({ path: SCREENSHOT_PATH, clip: { x: clipX, y: Math.floor(boundingBox.y), width: clipWidth, height: clipHeight }});
                    console.log('Clipped screenshot saved successfully.');
                } else {
                    console.warn('Bounding box is 0. Taking full page screenshot instead.');
                    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true }); 
                }
            } else {
                console.warn(`Element "${calendarElementSelector}" not found. Taking full page screenshot instead.`);
                await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true }); 
            }
        } catch (screenshotError) {
            if (!fs.existsSync(SCREENSHOT_PATH) && page && !page.isClosed()) { 
                 await page.screenshot({ path: DEBUG_SCREENSHOT_PATH, fullPage: true }); 
            }
            throw screenshotError;
        }

    } catch (error) {
        console.error('General error during screenshot process:', error.message);
        if (page && !page.isClosed() &&
            !fs.existsSync(DEBUG_SCREENSHOT_PATH) &&
            !fs.existsSync(SCREENSHOT_PATH)) {
            try {
                await page.screenshot({ path: ERROR_SCREENSHOT_PATH, fullPage: true });
            } catch (ssError) {}
        }
        throw error;
    } finally {
        if (browser) await browser.close();
    }
}

async function sendFileToDiscord(filePath, fileName, title) {
    const formData = new FormData();
    formData.append('file1', fs.createReadStream(filePath), { filename: fileName, contentType: 'image/png' });
    formData.append('payload_json', JSON.stringify({ content: title }));

    try {
        await axios.post(DISCORD_WEBHOOK_URL, formData, { headers: formData.getHeaders() });
        console.log(`Successfully sent ${fileName} to Discord.`);
    } catch (error) {
        console.error(`Error sending to Discord:`, error.message);
    }
}

async function sendToDiscord() {
    if (!DISCORD_WEBHOOK_URL) return;
    
    if (fs.existsSync(SCREENSHOT_PATH)) {
        await sendFileToDiscord(SCREENSHOT_PATH, 'forex_calendar.png', `📅 **Forex Factory Calendar - ${new Date().toDateString()}**`);
    } else if (fs.existsSync(DEBUG_SCREENSHOT_PATH)) { 
        await sendFileToDiscord(DEBUG_SCREENSHOT_PATH, 'forex_calendar_debug.png', `⚠️ **DEBUG: Forex Factory Calendar - ${new Date().toDateString()}**`);
    } 
}

async function main() {
    try {
        await takeScreenshot();
        await sendToDiscord();
    } catch (error) {
        process.exit(1);
    }
}

main();
