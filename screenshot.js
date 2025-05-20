const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

const FOREX_FACTORY_URL = 'https://www.forexfactory.com/calendar';
const SCREENSHOT_PATH = 'forex_calendar.png';
const DEBUG_SCREENSHOT_PATH = 'debug_screenshot.png'; // For debugging Cloudflare issues
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

async function takeScreenshot() {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({
        headless: true, // 'new' for newer versions
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--window-size=1600,1200'
        ]
    });
    const page = await browser.newPage();
    // Optional: Set a common user agent to look more like a real browser
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36');


    try {
        console.log(`Navigating to ${FOREX_FACTORY_URL}...`);
        // Initial navigation with a generous timeout for the first load
        await page.goto(FOREX_FACTORY_URL, { waitUntil: 'networkidle0', timeout: 90000 });

        console.log('Initial page load complete. Checking for Cloudflare / waiting for main content...');
        // Selector for an element that should ONLY exist on the actual calendar page,
        // NOT on the Cloudflare interstitial page.
        // This is the ID of the main div wrapping the calendar content on Forex Factory.
        const mainCalendarContentSelector = '#flexBox_flex_calendar_mainCal';

        try {
            console.log(`Waiting for selector "${mainCalendarContentSelector}" to appear...`);
            await page.waitForSelector(mainCalendarContentSelector, { timeout: 60000 }); // Wait up to 60 seconds
            console.log('Main calendar content loaded. Proceeding to screenshot.');
        } catch (error) {
            console.error(`Timeout or error waiting for selector "${mainCalendarContentSelector}". It's possible Cloudflare blocked access or the page structure changed.`);
            console.log('Taking a debug screenshot of the current page...');
            await page.screenshot({ path: DEBUG_SCREENSHOT_PATH, fullPage: true });
            console.log(`Debug screenshot saved to ${DEBUG_SCREENSHOT_PATH}. Check workflow artifacts.`);
            throw error; // Re-throw to fail the job and indicate the issue
        }

        // --- Optional: Handle Cookie Banner (if present AFTER Cloudflare) ---
        // ... (your cookie banner logic if needed)

        console.log('Taking screenshot of the calendar page...');
        // Ensure the page has some height before fullPage screenshot
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1000); // Give it a moment to render everything scrolled
        await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });

        console.log(`Screenshot saved to ${SCREENSHOT_PATH}`);

    } catch (error) {
        console.error('Error during screenshot process:', error);
        // If a debug screenshot wasn't already taken, take one now
        if (!fs.existsSync(DEBUG_SCREENSHOT_PATH) && !fs.existsSync(SCREENSHOT_PATH)) {
            try {
                await page.screenshot({ path: 'error_screenshot.png', fullPage: true });
                console.log('Error screenshot saved as error_screenshot.png');
            } catch (ssError) {
                console.error('Could not take error screenshot:', ssError);
            }
        }
        throw error;
    } finally {
        await browser.close();
        console.log('Browser closed.');
    }
}

async function sendToDiscord() {
    // ... (your sendToDiscord function remains the same) ...
    if (!DISCORD_WEBHOOK_URL) {
        console.error('DISCORD_WEBHOOK_URL is not set.');
        return;
    }
    if (!fs.existsSync(SCREENSHOT_PATH)) {
        console.error(`Screenshot file ${SCREENSHOT_PATH} not found.`);
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
        throw error;
    }
}

async function main() {
    try {
        await takeScreenshot();
        await sendToDiscord();
    } catch (error) {
        console.error('Script failed:', error.message);
        process.exit(1);
    }
}

main();
