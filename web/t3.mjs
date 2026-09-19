// Does ANY modal appear between clicking Send and the greeting landing?
import {chromium} from 'playwright';
const BASE = 'http://127.0.0.1:4599';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`${BASE}/offline-demo/`, {waitUntil: 'load'});
await page.waitForSelector(
	'text=Everything below runs against a chain inside this tab',
	{timeout: 60000},
);

const seen = new Set();
let polling = true;
const watch = (async () => {
	while (polling) {
		const t = await page
			.locator('body')
			.innerText()
			.catch(() => '');
		for (const phrase of [
			'Getting your transaction ready',
			'Waiting for Wallet Connection',
			'Please Accept Connection Request',
			'Wallet Action Required',
			'wallets available, choose one',
			'accounts available, choose one',
			'Confirm the transaction in your wallet',
		]) {
			if (t.includes(phrase)) seen.add(phrase);
		}
		await page.waitForTimeout(100);
	}
})();

const GREETING = 'quiet please';
await page.locator('input').first().fill(GREETING);
await page.locator('button', {hasText: 'Send'}).first().click();

let confirmed = false;
for (let i = 0; i < 80; i++) {
	const row = await page
		.locator('[data-testid="message-row"]')
		.first()
		.innerText()
		.catch(() => '');
	const pending = await page.locator('[data-testid="message-pending"]').count();
	if (row.includes(GREETING) && pending === 0) {
		confirmed = true;
		break;
	}
	await page.waitForTimeout(250);
}
polling = false;
await watch;
console.log('confirmed:', confirmed);
console.log('modals seen:', seen.size === 0 ? 'NONE' : [...seen]);
await browser.close();
