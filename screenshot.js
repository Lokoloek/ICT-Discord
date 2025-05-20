const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

const FOREX_FACTORY_URL = 'https://www.forexfactory.com/calendar';
const SCREENSHOT_PATH = 'forex_calendar.png';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL; // Get from environment variable

async function takeScreenshot() {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({
        headless: true, // 'new' for newer versions, true for older
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // Important for running in CI environments
            '--window-size=1600,1200' // Adjust viewport for better screenshot
        ]
    });
    const page = await browser.newPage();

    try {
        console.log(`Navigating to ${FOREX_FACTORY_URL}...`);
        await page.goto(FOREX_FACTORY_URL, { waitUntil: 'networkidle0', timeout: 60000 });

        // --- Optional: Handle Cookie Banner (if present) ---
        // Inspect ForexFactory for the cookie banner's selector if it exists and uncomment/adjust.
        // Example:
        // const cookieBannerSelector = '#cookie-banner-accept-button'; // Fictional selector
        // try {
        //     await page.waitForSelector(cookieBannerSelector, { timeout: 5000 });
        //     await page.click(cookieBannerSelector);
        //     console.log('Clicked cookie banner.');
        //     await page.waitForTimeout(1000); // Wait a bit for it to disappear
        // } catch (error) {
        //     console.log('Cookie banner not found or already accepted.');
        // }
        // --- End Optional Cookie Banner ---

        // --- Optional: Target a specific element ---
        // If you want to screenshot only the calendar table, inspect its selector.
        // Example:
        // const calendarElement = await page.$('#calendar'); // Fictional selector for the calendar div/table
        // if (calendarElement) {
        //     console.log('Taking screenshot of the calendar element...');
        //     await calendarElement.screenshot({ path: SCREENSHOT_PATH });
        // } else {
        //     console.log('Calendar element not found, taking full page screenshot.');
        //     await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
        // }
        // --- End Optional Target Element ---

        // For now, let's take a full page screenshot or a viewport screenshot
        console.log('Taking screenshot...');
        // Ensure the page has some height before fullPage screenshot
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1000); // Give it a moment to render everything scrolled
        await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true }); // Or just { path: SCREENSHOT_PATH } for viewport

        console.log(`Screenshot saved to ${SCREENSHOT_PATH}`);

    } catch (error) {
        console.error('Error during screenshot process:', error);
        throw error; // Re-throw to fail the GitHub Action
    } finally {
        await browser.close();
        console.log('Browser closed.');
    }
}

async function sendToDiscord() {
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
        throw error; // Re-throw
    }
}

async function main() {
    try {
        await takeScreenshot();
        await sendToDiscord();
    } catch (error) {
        console.error('Script failed:', error.message);
        process.exit(1); // Exit with error code to fail GitHub Action
    }
}

main();
