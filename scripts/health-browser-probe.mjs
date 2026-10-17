// A caller supplies its real browser page; no browser is launched by health CLI.
export async function probeRenderedEdition(page, {url, date}) {
  await page.goto(url, {waitUntil:'domcontentloaded'});
  await page.waitForFunction(expected => document.querySelector('#navDate')?.textContent.trim() === expected, date, {timeout:15000});
  return page.evaluate(() => ({ method:'browser', checkedAt:new Date().toISOString(), url:location.href,
    displayedDate:document.querySelector('#navDate')?.textContent.trim(),
    selectedDate:document.querySelector('#archiveDate')?.value,
    downloadUrl:document.querySelector('#downloadPng')?.href,
    title:document.title }));
}
