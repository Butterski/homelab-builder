import { useEffect } from 'react';

type SeoMetaProps = {
  title: string;
  description: string;
  path?: string;
  image?: string;
  type?: 'website' | 'article';
  keywords?: string[];
  structuredData?: Record<string, unknown> | Array<Record<string, unknown>>;
};

const DEFAULT_IMAGE = 'https://hlbldr.com/og-image.png';

function upsertMeta(selector: string, create: () => HTMLMetaElement) {
  let element = document.head.querySelector(selector) as HTMLMetaElement | null;
  let created = false;

  if (!element) {
    element = create();
    document.head.appendChild(element);
    created = true;
  }

  return { element, created };
}

function upsertCanonical() {
  let element = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  let created = false;

  if (!element) {
    element = document.createElement('link');
    element.setAttribute('rel', 'canonical');
    document.head.appendChild(element);
    created = true;
  }

  return { element, created };
}

export function SeoMeta({
  title,
  description,
  path,
  image = DEFAULT_IMAGE,
  type = 'website',
  keywords,
  structuredData,
}: SeoMetaProps) {
  useEffect(() => {
    const previousTitle = document.title;
    const updates: Array<() => void> = [];

    document.title = title;

    const descriptionMeta = upsertMeta('meta[name="description"]', () => {
      const element = document.createElement('meta');
      element.setAttribute('name', 'description');
      return element;
    });
    const previousDescription = descriptionMeta.element.getAttribute('content');
    descriptionMeta.element.setAttribute('content', description);
    updates.push(() => {
      if (descriptionMeta.created) {
        descriptionMeta.element.remove();
        return;
      }

      if (previousDescription === null) {
        descriptionMeta.element.removeAttribute('content');
      } else {
        descriptionMeta.element.setAttribute('content', previousDescription);
      }
    });

    if (keywords?.length) {
      const keywordsMeta = upsertMeta('meta[name="keywords"]', () => {
        const element = document.createElement('meta');
        element.setAttribute('name', 'keywords');
        return element;
      });
      const previousKeywords = keywordsMeta.element.getAttribute('content');
      keywordsMeta.element.setAttribute('content', keywords.join(', '));
      updates.push(() => {
        if (keywordsMeta.created) {
          keywordsMeta.element.remove();
          return;
        }

        if (previousKeywords === null) {
          keywordsMeta.element.removeAttribute('content');
        } else {
          keywordsMeta.element.setAttribute('content', previousKeywords);
        }
      });
    }

    const ogTitle = upsertMeta('meta[property="og:title"]', () => {
      const element = document.createElement('meta');
      element.setAttribute('property', 'og:title');
      return element;
    });
    const previousOgTitle = ogTitle.element.getAttribute('content');
    ogTitle.element.setAttribute('content', title);
    updates.push(() => {
      if (ogTitle.created) {
        ogTitle.element.remove();
        return;
      }

      if (previousOgTitle === null) {
        ogTitle.element.removeAttribute('content');
      } else {
        ogTitle.element.setAttribute('content', previousOgTitle);
      }
    });

    const ogDescription = upsertMeta('meta[property="og:description"]', () => {
      const element = document.createElement('meta');
      element.setAttribute('property', 'og:description');
      return element;
    });
    const previousOgDescription = ogDescription.element.getAttribute('content');
    ogDescription.element.setAttribute('content', description);
    updates.push(() => {
      if (ogDescription.created) {
        ogDescription.element.remove();
        return;
      }

      if (previousOgDescription === null) {
        ogDescription.element.removeAttribute('content');
      } else {
        ogDescription.element.setAttribute('content', previousOgDescription);
      }
    });

    const ogType = upsertMeta('meta[property="og:type"]', () => {
      const element = document.createElement('meta');
      element.setAttribute('property', 'og:type');
      return element;
    });
    const previousOgType = ogType.element.getAttribute('content');
    ogType.element.setAttribute('content', type);
    updates.push(() => {
      if (ogType.created) {
        ogType.element.remove();
        return;
      }

      if (previousOgType === null) {
        ogType.element.removeAttribute('content');
      } else {
        ogType.element.setAttribute('content', previousOgType);
      }
    });

    const ogImage = upsertMeta('meta[property="og:image"]', () => {
      const element = document.createElement('meta');
      element.setAttribute('property', 'og:image');
      return element;
    });
    const previousOgImage = ogImage.element.getAttribute('content');
    ogImage.element.setAttribute('content', image);
    updates.push(() => {
      if (ogImage.created) {
        ogImage.element.remove();
        return;
      }

      if (previousOgImage === null) {
        ogImage.element.removeAttribute('content');
      } else {
        ogImage.element.setAttribute('content', previousOgImage);
      }
    });

    const twitterTitle = upsertMeta('meta[name="twitter:title"]', () => {
      const element = document.createElement('meta');
      element.setAttribute('name', 'twitter:title');
      return element;
    });
    const previousTwitterTitle = twitterTitle.element.getAttribute('content');
    twitterTitle.element.setAttribute('content', title);
    updates.push(() => {
      if (twitterTitle.created) {
        twitterTitle.element.remove();
        return;
      }

      if (previousTwitterTitle === null) {
        twitterTitle.element.removeAttribute('content');
      } else {
        twitterTitle.element.setAttribute('content', previousTwitterTitle);
      }
    });

    const twitterDescription = upsertMeta('meta[name="twitter:description"]', () => {
      const element = document.createElement('meta');
      element.setAttribute('name', 'twitter:description');
      return element;
    });
    const previousTwitterDescription = twitterDescription.element.getAttribute('content');
    twitterDescription.element.setAttribute('content', description);
    updates.push(() => {
      if (twitterDescription.created) {
        twitterDescription.element.remove();
        return;
      }

      if (previousTwitterDescription === null) {
        twitterDescription.element.removeAttribute('content');
      } else {
        twitterDescription.element.setAttribute('content', previousTwitterDescription);
      }
    });

    const twitterImage = upsertMeta('meta[name="twitter:image"]', () => {
      const element = document.createElement('meta');
      element.setAttribute('name', 'twitter:image');
      return element;
    });
    const previousTwitterImage = twitterImage.element.getAttribute('content');
    twitterImage.element.setAttribute('content', image);
    updates.push(() => {
      if (twitterImage.created) {
        twitterImage.element.remove();
        return;
      }

      if (previousTwitterImage === null) {
        twitterImage.element.removeAttribute('content');
      } else {
        twitterImage.element.setAttribute('content', previousTwitterImage);
      }
    });

    if (path) {
      const fullUrl = new URL(path, window.location.origin).toString();

      const canonical = upsertCanonical();
      const previousCanonical = canonical.element.getAttribute('href');
      canonical.element.setAttribute('href', fullUrl);
      updates.push(() => {
        if (canonical.created) {
          canonical.element.remove();
          return;
        }

        if (previousCanonical === null) {
          canonical.element.removeAttribute('href');
        } else {
          canonical.element.setAttribute('href', previousCanonical);
        }
      });

      const ogUrl = upsertMeta('meta[property="og:url"]', () => {
        const element = document.createElement('meta');
        element.setAttribute('property', 'og:url');
        return element;
      });
      const previousOgUrl = ogUrl.element.getAttribute('content');
      ogUrl.element.setAttribute('content', fullUrl);
      updates.push(() => {
        if (ogUrl.created) {
          ogUrl.element.remove();
          return;
        }

        if (previousOgUrl === null) {
          ogUrl.element.removeAttribute('content');
        } else {
          ogUrl.element.setAttribute('content', previousOgUrl);
        }
      });
    }

    let structuredDataScript: HTMLScriptElement | null = null;
    if (structuredData) {
      structuredDataScript = document.createElement('script');
      structuredDataScript.type = 'application/ld+json';
      structuredDataScript.textContent = JSON.stringify(structuredData);
      document.head.appendChild(structuredDataScript);
      updates.push(() => {
        structuredDataScript?.remove();
      });
    }

    return () => {
      document.title = previousTitle;
      for (let index = updates.length - 1; index >= 0; index -= 1) {
        updates[index]();
      }
    };
  }, [description, image, keywords, path, structuredData, title, type]);

  return null;
}