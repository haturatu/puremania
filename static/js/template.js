
const templateCache = new Map();

/**
 * Fetches an HTML template from the given URL and caches it.
 * @param {string} url - The URL of the template file.
 * @returns {Promise<HTMLTemplateElement>}
 */
export async function loadTemplate(url) {
  if (templateCache.has(url)) {
    return templateCache.get(url);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load template: ${url}`);
  }
  const html = await response.text();
  const temp = document.createElement('div');
  temp.innerHTML = html.trim();
  const templateElement = temp.firstElementChild;

  if (!templateElement || templateElement.tagName !== 'TEMPLATE') {
    throw new Error(`Invalid template file format: ${url}`);
  }

  templateCache.set(url, templateElement);
  return templateElement;
}

/**
 * Gets the content of a loaded template.
 * @param {string} url - The URL of the template that was loaded.
 * @returns {DocumentFragment} - The cloned template content.
 */
export function getTemplateContent(url) {
  const template = templateCache.get(url);
  if (!template) {
    throw new Error(`Template not found or not loaded: ${url}`);
  }
  return template.content.cloneNode(true);
}

/**
 * Loads multiple templates and stores them in the cache.
 * @param {string[]} urls - An array of template URLs to load.
 */
export async function loadTemplates(urls) {
  await Promise.all(urls.map(url => loadTemplate(url)));
}
