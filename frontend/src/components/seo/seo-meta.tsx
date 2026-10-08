import { useEffect } from 'react';

type SeoMetaProps = {
  title: string;
  description: string;
  path?: string;
  image?: string;
  type?: 'website' | 'article';
  keywords?: string[];
  robots?: string;
  structuredData?: Record<string, unknown> | Array<Record<string, unknown>>;
};

const DEFAULT_IMAGE = 'https://hlbldr.com/og-image.png';
const DEFAULT_SITE_URL = 'https://hlbldr.com';
const SITE_URL = (import.meta.env.VITE_PUBLIC_SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, '');

/**
 * Sets one attribute of a head element such as `meta[name="description"]`,
 * adding the element when the page has none. Returns what puts the head back.
 */
function setHeadAttribute(
  tag: 'meta' | 'link',
  [keyName, keyValue]: [string, string],
  attribute: string,
  value: string,
): () => void {
  const existing = document.head.querySelector(`${tag}[${keyName}="${keyValue}"]`);
  const element = existing ?? document.createElement(tag);
  if (!existing) {
    element.setAttribute(keyName, keyValue);
    document.head.appendChild(element);
  }

  const previous = element.getAttribute(attribute);
  element.setAttribute(attribute, value);

  return () => {
    if (!existing) {
      element.remove();
    } else if (previous === null) {
      element.removeAttribute(attribute);
    } else {
      element.setAttribute(attribute, previous);
    }
  };
}

export function SeoMeta({
  title,
  description,
  path,
  image = DEFAULT_IMAGE,
  type = 'website',
  keywords,
  robots,
  structuredData,
}: SeoMetaProps) {
  useEffect(() => {
    const meta = (key: [string, string], content: string) => setHeadAttribute('meta', key, 'content', content);
    const restores: Array<() => void> = [];

    document.title = title;

    restores.push(meta(['name', 'description'], description));
    if (keywords?.length) restores.push(meta(['name', 'keywords'], keywords.join(', ')));
    if (robots) restores.push(meta(['name', 'robots'], robots));
    restores.push(
      meta(['property', 'og:title'], title),
      meta(['property', 'og:description'], description),
      meta(['property', 'og:type'], type),
      meta(['property', 'og:image'], image),
      meta(['name', 'twitter:title'], title),
      meta(['name', 'twitter:description'], description),
      meta(['name', 'twitter:image'], image),
    );

    if (path) {
      const fullUrl = new URL(path, `${SITE_URL}/`).toString();
      restores.push(
        setHeadAttribute('link', ['rel', 'canonical'], 'href', fullUrl),
        meta(['property', 'og:url'], fullUrl),
      );
    }

    if (structuredData) {
      const structuredDataScript = document.createElement('script');
      structuredDataScript.type = 'application/ld+json';
      structuredDataScript.textContent = JSON.stringify(structuredData);
      document.head.appendChild(structuredDataScript);
      restores.push(() => structuredDataScript.remove());
    }

    return () => {
      for (let index = restores.length - 1; index >= 0; index -= 1) {
        restores[index]();
      }
    };
  }, [description, image, keywords, path, robots, structuredData, title, type]);

  return null;
}
