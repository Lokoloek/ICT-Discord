// BOVENAAN:
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

// --- NIEUWE CONSTANTEN VOOR LOGIN ---
const CALENDAR_URL = 'https://www.forexfactory.com/calendar'; // Was FOREX_FACTORY_URL
const LOGIN_URL = 'https://www.forexfactory.com/login';

const USERNAME_SELECTOR = '#login_username';
const PASSWORD_SELECTOR = '#login_password';
const LOGIN_BUTTON_SELECTOR = 'input[type="submit"].button';
const LOGIN_SUCCESS_SELECTOR = 'a.logout'; // Gebaseerd op jouw screenshot van de logout knop

const SCREENSHOT_PATH = 'forex_calendar.png';
const DEBUG_SCREENSHOT_PATH = 'debug_screenshot.png';
const LOGIN_FAILED_SCREENSHOT_PATH = 'login_failed_debug.png'; // Toegevoegd
const ERROR_SCREENSHOT_PATH = 'error_screenshot.png'; // Toegevoegd

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const FOREX_USER = process.env.FOREX_FACTORY_USER; // Voor je username secret
const FOREX_PASS = process.env.FOREX_FACTORY_PASS; // Voor je password secret
// --- EINDE NIEUWE CONSTANTEN ---

async function takeScreenshot() {
    // Check of de secrets zijn ingesteld
    if (!FOREX_USER || !FOREX_PASS) {
        console.error('Forex Factory username or password not set in GitHub Secrets (FOREX_FACTORY_USER, FOREX_FACTORY_PASS).');
        throw new Error('Missing login credentials.');
    }

    console.log('Launching stealth browser with refined options...');
    const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'; // Recente user agent

    const browser = await puppeteer.launch({
        headless: 'new', // 'new' headless mode, vaak beter voor stealth
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-infobars',
            '--window-position=0,0',
            '--ignore-certificate-errors',
            '--ignore-certificate-errors-spki-list',
            `--user-agent=${userAgent}`,
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920,1080', // Gangbare desktopresolutie
            '--lang=en-US,en;q=0.9',
            '--accept-language=en-US,en;q=0.9',
        ],
        ignoreDefaultArgs: ['--enable-automation'], // Belangrijk voor detectie
    });

    const page = await browser.newPage();
    await page.setUserAgent(userAgent);
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setExtraHTTPHeaders({
        'accept-language': 'en-US,en;q=0.9',
    });

    try {
        // --- LOGIN STAP ---
        console.log(`Navigating to login page: ${LOGIN_URL}`);
        await page.goto(LOGIN_URL, { waitUntil: 'networkidle0', timeout: 60000 });

        console.log('Waiting for login form elements...');
        await page.waitForSelector(USERNAME_SELECTOR, { timeout: 30000, visible: true });
        await page.waitForSelector(PASSWORD_SELECTOR, { timeout: 30000, visible: true });
        await page.waitForSelector(LOGIN_BUTTON_SELECTOR, { timeout: 30000, visible: true });

        console.log('Typing username...');
        await page.type(USERNAME_SELECTOR, FOREX_USER);
        await page.waitForTimeout(500); // Kleine pauze

        console.log('Typing password...');
        await page.type(PASSWORD_SELECTOR, FOREX_PASS);
        await page.waitForTimeout(500); // Kleine pauze

        console.log('Clicking login button...');
        await Promise.all([
            page.click(LOGIN_BUTTON_SELECTOR),
            page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 })
        ]);
        
        console.log('Login attempt submitted. Verifying login...');
        if (LOGIN_SUCCESS_SELECTOR) {
            try {
                await page.waitForSelector(LOGIN_SUCCESS_SELECTOR, { timeout: 30000, visible: true });
                console.log('Login successful! (Success selector found)');
            } catch (e) {
                console.warn('Login success selector not found. Login might have failed or page structure changed.');
                await page.screenshot({ path: LOGIN_FAILED_SCREENSHOT_PATH, fullPage: true });
                console.log(`Screenshot of potentially failed login page saved to ${LOGIN_FAILED_SCREENSHOT_PATH}`);
                throw new Error('Failed to verify login success after submitting credentials.');
            }
        } else {
            console.log('No login success selector provided, assuming login worked if no immediate error. Waiting a bit...');
            await page.waitForTimeout(3000); // Wacht even om te zien of er een error pagina komt.
        }
        // --- EINDE LOGIN STAP ---

        console.log(`Navigating to calendar page: ${CALENDAR_URL}...`);
        await page.goto(CALENDAR_URL, { waitUntil: 'networkidle0', timeout: 90000 });

        console.log('Calendar page loaded (after login). Checking for main content...');
        const mainCalendarContentSelector = '#flexBox_flex_calendar_mainCal';

        try {
            console.log(`Waiting for selector "${mainCalendarContentSelector}" to appear...`);
            await page.waitForSelector(mainCalendarContentSelector, { timeout: 60000, visible: true });
            console.log('Main calendar content loaded. Proceeding to screenshot.');
        } catch (error) {
            console.error(`Timeout or error waiting for calendar selector AFTER LOGIN. Current URL: ${page.url()}`);
            await page.screenshot({ path: DEBUG_SCREENSHOT_PATH, fullPage: true });
            console.log(`Debug screenshot (after supposed login, waiting for calendar) saved to ${DEBUG_SCREENSHOT_PATH}.`);
            throw error; // Hergooi de error zodat de main catch het oppakt
        }

        console.log('Taking screenshot of the calendar page...');
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1000); // Geef tijd om te renderen na scroll
        await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });

        console.log(`Screenshot saved to ${SCREENSHOT_PATH}`);

    } catch (error) {
        console.error('Error during screenshot process:', error.message);
        // Probeer een algemene error screenshot te maken als er nog geen specifieke debug screenshot is gemaakt
        const pageStillOpen = page && !page.isClosed();
        if (pageStillOpen && !fs.existsSync(DEBUG_SCREENSHOT_PATH) && !fs.existsSync(LOGIN_FAILED_SCREENSHOT_PATH) && !fs.existsSync(SCREENSHOT_PATH)) {
            try {
                await page.screenshot({ path: ERROR_SCREENSHOT_PATH, fullPage: true });
                console.log(`General error screenshot saved as ${ERROR_SCREENSHOT_PATH}`);
            } catch (ssError) {
                console.error('Could not take general error screenshot:', ssError.message);
            }
        }
        throw error; // Hergooi de error zodat main() het afhandelt
    } finally {
        if (browser) { // Controleer of browser bestaat voordat je close aanroept
            await browser.close();
            console.log('Browser closed.');
        }
    }
}

async function sendToDiscord() {
    if (!DISCORD_WEBHOOK_URL) {
        console.error('DISCORD_WEBHOOK_URL is not set.');
        return;
    }
    if (!fs.existsSync(SCREENSHOT_PATH)) {
        console.warn(`Screenshot file ${SCREENSHOT_PATH} not found. Not sending to Discord.`);
        // Optioneel: stuur een debug screenshot als de hoofd-screenshot mist
        // if (fs.existsSync(DEBUG_SCREENSHOT_PATH)) { ... }
        // else if (fs.existsSync(LOGIN_FAILED_SCREENSHOT_PATH)) { ... }
        return;
    }

    console.log('Sending screenshot to Discord...');
    const formData = new FormData();
    formData.append('file1', fs.createReadStream(SCREENSHOT_PATH), {
        filename: 'forex_calendar.png',
        contentType: 'image/png',
    });
    formData.append('payload_json', JSON.stringify({
        content: `📅 **Forex Factory Calendar - ${new Date().toDateString()}**`
    }));

    try {
        const response = await axios.post(DISCORD_WEBHOOK_URL, formData, {
            headers: formData.getHeaders(),
        });
        console.log('Successfully sent to Discord:', response.status);
    } catch (error) {
        console.error('Error sending to Discord:');
        if (error.response) {
            console.error('Data:', error.response.data);
            console.error('Status:', error.response.status);
            console.error('Headers:', error.response.headers);
        } else if (error.request) {
            console.error('Request:', error.request);
        } else {
            console.error('Error Message:', error.message);
        }
        // Gooi de error niet opnieuw als Discord faalt, de screenshot kan wel gemaakt zijn.
    }
}

async function main() {
    try {
        await takeScreenshot();
        await sendToDiscord();
    } catch (error) {
        // Error van takeScreenshot (of een andere onverwachte error) wordt hier opgevangen
        console.error('Script failed:', error.message);
        process.exit(1); // Zorgt ervoor dat de GitHub Action faalt
    }
}

main();
