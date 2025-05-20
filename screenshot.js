// At the top, change how puppeteer is required:
// const puppeteer = require('puppeteer'); // REMOVE THIS LINE
const puppeteer = require('puppeteer-extra'); // USE THIS INSTEAD
const StealthPlugin = require('puppeteer-extra-plugin-stealth'); // ADD THIS
puppeteer.use(StealthPlugin()); // ADD THIS to activate the stealth plugin

const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

const FOREX_FACTORY_URL = 'https://www.forexfactory.com/calendar';
const SCREENSHOT_PATH = 'forex_calendar.png';
const DEBUG_SCREENSHOT_PATH = 'debug_screenshot.png';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

async function takeScreenshot() {
    console.log('Launching stealth browser...'); // Updated log message
    const browser = await puppeteer.launch({
        headless: true, // Puppeteer-extra-plugin-stealth works best with headless: true or 'new'
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--window-size=1600,1200'
            // Stealth plugin handles many evasions, so fewer specific args might be needed here
        ]
    });
    const page = await browser.newPage();
    // Stealth plugin also helps with User-Agent, but setting one explicitly doesn't hurt
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36');
    // Optional: Set viewport for consistency
    await page.setViewport({ width: 1600, height: 1200 });


    try {
        console.log(`Navigating to ${FOREX_FACTORY_URL}...`);
        await page.goto(FOREX_FACTORY_URL, { waitUntil: 'networkidle0', timeout: 90000 });

        console.log('Initial page load complete. Checking for Cloudflare / waiting for main content...');
        const mainCalendarContentSelector = '#flexBox_flex_calendar_mainCal';

        try {
            console.log(`Waiting for selector "${mainCalendarContentSelector}" to appear...`);
            await page.waitForSelector(mainCalendarContentSelector, { timeout: 60000 });
            console.log('Main calendar content loaded. Proceeding to screenshot.');
        } catch (error) {
            console.error(`Timeout or error waiting for selector "${mainCalendarContentSelector}". It's possible Cloudflare blocked access or the page structure changed.`);
            console.log('Taking a debug screenshot of the current page...');
            await page.screenshot({ path: DEBUG_SCREENSHOT_PATH, fullPage: true });
            console.log(`Debug screenshot saved to ${DEBUG_SCREENSHOT_PATH}. Check workflow artifacts.`);
            throw error;
        }

        console.log('Taking screenshot of the calendar page...');
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1000);
        await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });

        console.log(`Screenshot saved to ${SCREENSHOT_PATH}`);

    } catch (error) {
        console.error('Error during screenshot process:', error.message);
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

// sendToDiscord and main functions remain the same
async function sendToDiscord() {
    if (!DISCORD_WEBHOOK_URL) {
        console.error('DISCORD_WEBHOOK_URL is not set.');
        return; // Exit if no webhook
    }
    if (!fs.existsSync(SCREENSHOT_PATH)) {
        console.warn(`Screenshot file ${SCREENSHOT_PATH} not found. Not sending to Discord.`);
        // Optionally, you could send the debug_screenshot.png if the main one failed
        // if (fs.existsSync(DEBUG_SCREENSHOT_PATH)) {
        //    console.log('Attempting to send debug screenshot instead...');
        //    // ... logic to send DEBUG_SCREENSHOT_PATH ...
        // }
        return; // Exit if no primary screenshot
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
        // Don't re-throw here if screenshot was taken but discord failed,
        // as the main goal (screenshot) might be achieved.
        // Or handle it as a full failure if Discord is critical.
    }
}

async function main() {
    try {
        await takeScreenshot(); // This will create SCREENSHOT_PATH or throw error
        await sendToDiscord();  // This will attempt to send SCREENSHOT_PATH
    } catch (error) {
        // Error from takeScreenshot will be caught here
        console.error('Script failed:', error.message); // Error.message is better here
        process.exit(1);
    }
}

main();
