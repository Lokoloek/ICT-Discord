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

// --- NIEUWE FILTER SELECTORS ---
const FILTER_BUTTON_SELECTOR = 'li.calendar_filters span.calendar_filters'; // Klik op de "Filter" tekst
const APPLY_FILTER_BUTTON_SELECTOR_IN_OVERLAY = 'input[value="Apply Filter"].overlay_button--submit';
// Selector voor "none" link in de Currencies sectie. Dit is een gok en moet mogelijk worden aangepast.
// We gaan ervan uit dat "Currencies" de eerste filterbare lijst is.
const CURRENCIES_NONE_SELECTOR = 'div.flexcontrols__listcontainer:nth-of-type(1) a.flexcontrols__list_toggler_none';
const USD_CHECKBOX_SELECTOR = 'input#currency_0_1'; // Gebaseerd op label for="currency_0_1"

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
                '--disable-gpu', '--window-size=1920,1200', 
                '--lang=en-US,en;q=0.9', '--accept-language=en-US,en;q=0.9',
            ],
            ignoreDefaultArgs: ['--enable-automation'],
        });

        page = await browser.newPage();
        await page.setUserAgent(userAgent);
        await page.setViewport({ width: 1200, height: 1200 }); 
        await page.setExtraHTTPHeaders({'accept-language': 'en-US,en;q=0.9'});

        // --- LOGIN STAP --- (Blijft hetzelfde)
        // ... (volledige login flow) ...
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
            } catch (e) { /* ... error handling voor login verificatie ... */ }
        } else { /* ... */ }
        // --- EINDE LOGIN STAP ---

        console.log(`Navigating to calendar page (today view): ${CALENDAR_URL}...`);
        await page.goto(CALENDAR_URL, { waitUntil: 'networkidle0', timeout: 90000 });
        console.log(`Current URL is now: ${page.url()}`);

        console.log('Calendar page loaded. Waiting for calendar data to be present...');
        const calendarDataLoadedSelector = 'tr.calendar__row--new-day';
        try {
            await page.waitForSelector(calendarDataLoadedSelector, { timeout: 60000, visible: true });
            console.log('Initial calendar data loaded.');
        } catch (error) { /* ... error handling ... */ }


        // ***** BEGIN FILTER STAPPEN *****
        console.log('Attempting to apply USD currency filter...');
        try {
            console.log(`Clicking on filter button: ${FILTER_BUTTON_SELECTOR}`);
            await page.waitForSelector(FILTER_BUTTON_SELECTOR, { visible: true, timeout: 10000 });
            await page.click(FILTER_BUTTON_SELECTOR);
            console.log('Filter button clicked.');

            console.log(`Waiting for filter overlay to appear (waiting for Apply button: ${APPLY_FILTER_BUTTON_SELECTOR_IN_OVERLAY})`);
            await page.waitForSelector(APPLY_FILTER_BUTTON_SELECTOR_IN_OVERLAY, { visible: true, timeout: 10000 });
            console.log('Filter overlay is visible.');
            await new Promise(resolve => setTimeout(resolve, 1000)); // Geef overlay tijd om te renderen

            // Deselecteer alle currencies (klik op "none")
            console.log(`Clicking "none" for currencies: ${CURRENCIES_NONE_SELECTOR}`);
            await page.waitForSelector(CURRENCIES_NONE_SELECTOR, { visible: true, timeout: 5000 });
            await page.click(CURRENCIES_NONE_SELECTOR);
            await new Promise(resolve => setTimeout(resolve, 500)); // Wacht even na klik
            console.log('"None" for currencies clicked.');

            // Selecteer USD
            console.log(`Clicking USD checkbox: ${USD_CHECKBOX_SELECTOR}`);
            await page.waitForSelector(USD_CHECKBOX_SELECTOR, { visible: true, timeout: 5000 });
            // Controleer of de checkbox al aangevinkt is, zo niet, klik.
            // Dit is niet strikt nodig als we net alles hebben uitgevinkt, maar goede practice.
            // const isUsdChecked = await page.$eval(USD_CHECKBOX_SELECTOR, el => el.checked);
            // if (!isUsdChecked) {
            //    await page.click(USD_CHECKBOX_SELECTOR);
            // }
            await page.click(USD_CHECKBOX_SELECTOR); // Klik gewoon, na "none" zou het uit moeten zijn.
            await new Promise(resolve => setTimeout(resolve, 500));
            console.log('USD checkbox clicked.');

            // Klik op "Apply Filter"
            console.log(`Clicking "Apply Filter" button: ${APPLY_FILTER_BUTTON_SELECTOR_IN_OVERLAY}`);
            await page.click(APPLY_FILTER_BUTTON_SELECTOR_IN_OVERLAY);
            console.log('"Apply Filter" button clicked.');

            // Wacht tot de pagina herlaadt/update na het toepassen van de filter
            // We wachten opnieuw op de data van de kalender.
            // Het is mogelijk dat de pagina niet volledig herlaadt, maar de content update.
            // waitForNavigation kan hier problemen geven. We wachten op een verandering in de tabel.
            console.log('Waiting for calendar to update after applying filter...');
            // Een manier is te wachten tot een specifiek element (bv. de USD rij) ZICHTBAAR is
            // of wachten tot een element dat NIET USD is, ONZICHTBAAR wordt (lastiger).
            // Voor nu, wachten we gewoon opnieuw op de eerste dag-rij.
            await page.waitForSelector(calendarDataLoadedSelector, { visible: true, timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 2000)); // Extra wachttijd voor content
            console.log('Calendar updated with filter.');

        } catch (filterError) {
            console.error(`Error applying filter: ${filterError.message}`);
            console.log('Proceeding without filter, or taking debug screenshot of filter attempt...');
            await page.screenshot({ path: 'filter_error_debug.png', fullPage: true });
            console.log(`Debug screenshot of filter error saved to filter_error_debug.png. Check artifacts.`);
            // Je kunt hier besluiten om te falen of door te gaan zonder filter
            // throw filterError; // Uncomment om te falen als filteren mislukt
        }
        // ***** EINDE FILTER STAPPEN *****


        // --- VERWIJDER STORENDE ELEMENTEN --- (Blijft hetzelfde)
        try {
            console.log('Attempting to REMOVE distracting elements for a cleaner screenshot...');
            await page.evaluate(() => { /* ... selectorsToRemove en logica ... */ }); // Jouw bestaande opschoon code
            console.log('Distracting elements REMOVED.');
            await new Promise(resolve => setTimeout(resolve, 2500));
        } catch (evalError) { /* ... */ }
        
        // --- SCREENSHOT NEMEN MET CLIP --- (Blijft hetzelfde)
        console.log('Attempting to take a CLIPPED screenshot of the page (top-left).');
        try {
            const clipWidth = 1050; const clipHeight = 1080;
            await page.setViewport({ width: clipWidth + 50, height: clipHeight + 50 });
            await new Promise(resolve => setTimeout(resolve, 500));
            await page.screenshot({ path: SCREENSHOT_PATH, clip: { x: 0, y: 0, width: clipWidth, height: clipHeight }});
            console.log(`Clipped screenshot (${clipWidth}x${clipHeight} from top-left) saved to ${SCREENSHOT_PATH}`);
        } catch (screenshotError) { /* ... error handling ... */ }

    } catch (error) {
        console.error('General error during screenshot process:', error.message);
        // ... (rest van de error handling)
    } finally {
        // ... (finally block)
    }
}

// De sendToDiscord en main functies blijven hetzelfde
// ... (volledige sendFileToDiscord, sendToDiscord, main functies) ...
