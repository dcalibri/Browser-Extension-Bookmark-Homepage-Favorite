// Background-side helper to collect Google Classroom To-Do and Missing items
export async function collectGoogleClassroomData(openTabFn) {
	// openTabFn should open or focus a tab and return a Page-like interface with evaluate
	const GC_TODO_URL = 'https://classroom.google.com/u/0/a/not-turned-in/all';
	const GC_MISSING_URL = 'https://classroom.google.com/u/0/a/missing/all';

	const parsePage = async (page, type) => {
		// Heuristic selectors — Classroom UI may change; handle gracefully
		return await page.evaluate((typeInner) => {
			const items = [];
			const candidates = document.querySelectorAll('div[role=\"listitem\"], .YVvGBb');
			candidates.forEach(el => {
				const title = el.querySelector('a, .onkcGd, .YVvGBb a')?.textContent?.trim();
				const course = el.querySelector('.TQYoYc, .u73Apc')?.textContent?.trim();
				const due = el.querySelector('[data-tooltip*=\"Due\"], .NMm5M')?.textContent?.trim();
				if (title) items.push({ title, course, due, type: typeInner });
			});
			return items;
		}, type);
	};

	const openAndParse = async (url, type) => {
		const page = await openTabFn(url);
		await page.waitForTimeout(1500);
		return await parsePage(page, type);
	};

	const todo = await openAndParse(GC_TODO_URL, 'todo');
	const missing = await openAndParse(GC_MISSING_URL, 'missing');
	const all = [...todo, ...missing];

	const summary = `GC: ${todo.length} to-do, ${missing.length} missing`;
	return { items: all, summary };
}


