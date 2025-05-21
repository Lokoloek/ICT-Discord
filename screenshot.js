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
const PROFILE_URL = 'https://www.forexfactory.com/lokoloek'; // Je profielpagina URL

const USERNAME_SELECTOR = '#login_username';
const PASSWORD_SELECTOR = '#login_password';
const LOGIN_BUTTON_SELECTOR = 'input[type="submit"].button';
const LOGIN_SUCCESS_SELECTOR = 'a.logout'; // Selector voor de logout knop op je profielpagina

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
                '--disable-gpu', '--window-size=1920,1200', // Ruime start viewport
                '--lang=en-US,en;q=0.9', '--accept-language=en-US,en;q=0.9',
            ],
            ignoreDefaultArgs: ['--enable-automation'],
        });

        page = await browser.newPage();
        await page.setUserAgent(userAgent);
        // Begin met een redelijke viewport, wordt later mogelijk aangepast
        await page.setViewport({ width: 1200, height: 1200 }); 
        await page.setExtraHTTPHeaders({'accept-language': 'en-US,en;q=0.9'});

        // --- LOGIN STAP --- (Blijft hetzelfde)
        console.log(`Navigating to login page: ${LOGIN_URL}`);
        await page.goto(LOGIN_URL, { waitUntil: 'networkidle0', timeout: 60000 });
        // ... (rest van de login flow, die werkte) ...
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
            } catch (e) { /* ... error handling login verificatie ... */ }
        } else { /* ... */ }
        // --- EINDE LOGIN STAP ---

        console.log(`Navigating to calendar page (today view): ${CALENDAR_URL}...`);
        await page.goto(CALENDAR_URL, { waitUntil: 'networkidle0', timeout: 90000 });
        console.log(`Current URL is now: ${page.url()}`);

        console.log('Calendar page loaded. Waiting for calendar data to be present...');
        const calendarDataLoadedSelector = 'tr.calendar__row--new-day';
        try {
            await page.waitForSelector(calendarDataLoadedSelector, { timeout: 60000, visible: true });
            console.log('Main calendar data (first day row) loaded.');
        } catch (error) { /* ... error handling data load ... */ }

        // --- VERWIJDER STORENDE ELEMENTEN ---
        try {
            console.log('Attempting to REMOVE distracting elements for a cleaner screenshot...');
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
                document.body.style.overflow = 'hidden'; 
                const calendarContainer = document.getElementById('flexBox_flex_calendar_mainCal');
                if (calendarContainer) {
                    calendarContainer.style.margin = '0'; // Forceer naar linksboven
                    calendarContainer.style.padding = '5px'; // Behoud kleine padding
                    calendarContainer.style.border = 'none';
                    calendarContainer.style.boxShadow = 'none';
                }
                window.scrollTo(0,0);
            });
            console.log('Distracting elements REMOVED.');
            await new Promise(resolve => setTimeout(resolve, 2500));
        } catch (evalError) { /* ... error handling evaluate ... */ }
        
        // ***** BEGIN GEWIJZIGD SCREENSHOT BLOK (DYNAMISCHE HOOGTE) *****
        console.log('Attempting to take a CLIPPED screenshot with dynamic height...');
        try {
            const calendarElementSelector = '#flexBox_flex_calendar_mainCal';
            const calendarElement = await page.$(calendarElementSelector);

            if (calendarElement) {
                const boundingBox = await calendarElement.boundingBox();
                if (boundingBox && boundingBox.height > 0) {
                    const desiredWidth = 1050;
                    let clipX = Math.floor(boundingBox.x); 
                    // Als het element verder naar links begint dan 0 (door bijv. padding op body die we niet weghalen),
                    // moeten we daar rekening mee houden, maar door body padding 0 te maken en calendar margin 0,
                    // zou x dichtbij 0 moeten zijn. We nemen het voor de zekerheid mee.
                    let clipWidth = desiredWidth;
                    if ((clipX + desiredWidth) > boundingBox.width && boundingBox.width >= desiredWidth){ // Als de clip breder is dan het element maar het element is breed genoeg
                        // Doe niets, clipWidth blijft desiredWidth, x blijft boundingBox.x
                    } else if (boundingBox.width < desiredWidth) { // Als element smaller is dan gewenste clip
                        clipWidth = Math.ceil(boundingBox.width);
                    }
                     // Als x niet 0 is, en clippen op x met desiredWidth gaat buiten het element, pas clipX aan
                    if (clipX > 0 && (clipX + desiredWidth) > (boundingBox.x + boundingBox.width)) {
                        clipX = Math.max(0, (boundingBox.x + boundingBox.width) - desiredWidth);
                    }


                    const clipHeight = Math.ceil(boundingBox.height); // Precieze hoogte van het element
                    
                    // Zorg dat de viewport groot genoeg is voor de clip.
                    const requiredViewportWidth = clipX + clipWidth + 20; // + marge
                    const requiredViewportHeight = Math.ceil(boundingBox.y) + clipHeight + 20; // + marge
                    
                    const currentViewport = page.viewport();
                    if (currentViewport.width < requiredViewportWidth || currentViewport.height < requiredViewportHeight) {
                        console.log(`Adjusting viewport to ${requiredViewportWidth}x${requiredViewportHeight} for clip.`);
                        await page.setViewport({ 
                            width: Math.max(currentViewport.width, requiredViewportWidth), 
                            height: Math.max(currentViewport.height, requiredViewportHeight)
                        });
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                    
                    console.log(`Clipping at x:${clipX}, y:${Math.floor(boundingBox.y)}, width:${clipWidth}, height:${clipHeight}`);
                    await page.screenshot({
                        path: SCREENSHOT_PATH,
                        clip: {
                            x: clipX,
                            y: Math.floor(boundingBox.y), // Y-coördinaat van het element
                            width: clipWidth,
                            height: clipHeight
                        }
                    });
                    console.log(`Clipped screenshot (width: ${clipWidth}, height: ${clipHeight}) saved to ${SCREENSHOT_PATH}`);
                } else {
                    console.error('Could not get bounding box for calendar element or height is 0. Taking full page debug screenshot.');
                    await page.screenshot({ path: DEBUG_SCREENSHOT_PATH, fullPage: true });
                    throw new Error('Calendar element bounding box was null or height was 0.');
                }
            } else {
                console.error(`Calendar element "${calendarElementSelector}" not found. Taking full page debug screenshot.`);
                await page.screenshot({ path: DEBUG_SCREENSHOT_PATH, fullPage: true });
                throw new Error(`Could not find element ${calendarElementSelector} to screenshot.`);
            }
        } catch (screenshotError) { /* ... error handling screenshot ... */ }
        // ***** EINDE GEWIJZIGD SCREENSHOT BLOK *****

    } catch (error) {
        // ... (algemene error handling) ...
    } finally {
        // ... (finally block) ...
    }
}

// ... (sendToDiscord en main functies blijven hetzelfde) ...
