import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Service, Spec, ShoppingListItem as ShoppingItemType } from '../types';
import './ShoppingListPage.css';

type Locale = 'pl' | 'int';

const CATEGORY_ORDER = ['cpu', 'ram', 'storage', 'case', 'network', 'accessories'];
const CATEGORY_LABELS: Record<string, string> = {
  cpu: 'Processor',
  ram: 'Memory',
  storage: 'Storage',
  case: 'Case & Power',
  network: 'Networking',
  accessories: 'Accessories',
};

function ShoppingListPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as { spec?: Spec; tier?: string; services?: Service[] } | undefined;
  
  // Detect locale (default to PL if user language starts with 'pl', else 'int')
  const [locale, setLocale] = useState<Locale>(() => {
    return navigator.language.startsWith('pl') ? 'pl' : 'int';
  });

  if (!state?.spec) {
    return (
      <div className="shopping-page">
        <div className="error-state">
          <p>⚠️ No recommendation data. Please generate recommendations first.</p>
          <button className="btn-primary" onClick={() => navigate('/services')}>Select Services</button>
        </div>
      </div>
    );
  }

  const spec = state.spec;
  const items = generateLocalItems(spec, locale);

  const grouped = CATEGORY_ORDER.reduce<Record<string, typeof items>>((acc, cat) => {
    const catItems = items.filter((i) => i.category === cat);
    if (catItems.length > 0) acc[cat] = catItems;
    return acc;
  }, {});

  const totalCost = items.reduce((sum, item) => sum + item.estimated_price, 0);
  const currency = locale === 'pl' ? 'PLN' : 'USD'; // Simplified conversion display

  return (
    <div className="shopping-page">
      <div className="page-header">
        <h1>Shopping List</h1>
        <div className="header-meta">
          <p>
            {state.tier?.charAt(0).toUpperCase()}{state.tier?.slice(1)} tier —
            Estimated total: <strong>{totalCost} {currency}</strong>
          </p>
          <div className="locale-toggle">
            <button 
              className={locale === 'pl' ? 'active' : ''} 
              onClick={() => setLocale('pl')}
              title="Polish Stores (Amazon.pl, Allegro, x-kom)"
            >
              🇵🇱 PL
            </button>
            <button 
              className={locale === 'int' ? 'active' : ''} 
              onClick={() => setLocale('int')}
              title="International Stores (Amazon.com, eBay)"
            >
              🌍 Int
            </button>
          </div>
        </div>
      </div>

      <div className="shopping-groups">
        {Object.entries(grouped).map(([category, catItems]) => (
          <div key={category} className="shopping-group">
            <h3 className="group-title">{CATEGORY_LABELS[category] || category}</h3>
            <div className="group-items">
              {catItems.map((item, idx) => (
                <div key={idx} className={`shopping-item priority-${item.priority}`}>
                  <div className="item-info">
                    <span className="item-name">{item.name}</span>
                    {item.priority === 'optional' && (
                      <span className="item-badge optional">Optional</span>
                    )}
                  </div>
                  <div className="item-price">{item.estimated_price} {currency}</div>
                  <div className="item-links">
                    {item.purchase_links.map((link, i) => (
                      <a
                        key={i}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="purchase-link"
                      >
                        {link.store} ↗
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="shopping-summary">
        <div className="summary-row">
          <span>Essential items</span>
          <span>{items.filter(i => i.priority === 'essential').reduce((s, i) => s + i.estimated_price, 0)} {currency}</span>
        </div>
        <div className="summary-row">
          <span>Optional items</span>
          <span>{items.filter(i => i.priority === 'optional').reduce((s, i) => s + i.estimated_price, 0)} {currency}</span>
        </div>
        <div className="summary-row total">
          <span>Total Estimated Cost</span>
          <span>{totalCost} {currency}</span>
        </div>
      </div>

      <div className="shopping-actions">
        <button className="btn-secondary" onClick={() => navigate(-1)}>
          ← Back to Recommendations
        </button>
        <button className="btn-secondary" onClick={() => window.print()}>
          🖨️ Print List
        </button>
        <button
          className="btn-primary btn-large"
          onClick={() =>
            navigate('/checklist', {
              state: { services: state?.services || [], tier: state?.tier },
            })
          }
        >
          What's Next? → Setup Guide
        </button>
      </div>
    </div>
  );
}

// Generate items client-side from spec (avoids requiring a saved recommendation in DB)
function generateLocalItems(spec: Spec, locale: Locale): (ShoppingItemType & { purchase_links: { store: string; url: string }[] })[] {
  const items: (ShoppingItemType & { purchase_links: { store: string; url: string }[] })[] = [];
  
  // Approximate conversion rate: 1 USD = 4 PLN
  const toCurrency = (pln: number) => locale === 'pl' ? pln : Math.round(pln / 4);

  // Helper to get links based on locale
  const getLinks = (query: string, category: string) => { // eslint-disable-line @typescript-eslint/no-unused-vars
    const encoded = encodeURIComponent(query);
    if (locale === 'pl') {
      const links = [
        { store: 'Amazon.pl', url: `https://www.amazon.pl/s?k=${encoded}` },
        { store: 'Allegro', url: `https://allegro.pl/listing?string=${encoded}` },
        { store: 'x-kom', url: `https://www.x-kom.pl/szukaj?q=${encoded}` },
      ];
      // Add OLX/Vinted for used parts (CPU, RAM, Case)
      if (['cpu', 'ram', 'case'].includes(category)) {
        links.push({ store: 'OLX', url: `https://www.olx.pl/elektronika/komputery/q-${encoded.replace(/%20/g, '-')}/` });
        links.push({ store: 'Vinted', url: `https://www.vinted.pl/catalog?search_text=${encoded}` });
      }
      return links;
    } else {
      const links = [
        { store: 'Amazon.com', url: `https://www.amazon.com/s?k=${encoded}` },
        { store: 'eBay', url: `https://www.ebay.com/sch/i.html?_nkw=${encoded}` },
      ];
      // Vinted is international but domain changes. Keeping generic or UK for now? 
      // User said "vinted is international so we can keep this", but usually Vinted is region-locked. 
      // I'll add Vinted.com (redirects usually) or generic.
      if (['cpu', 'ram', 'case'].includes(category)) {
         links.push({ store: 'Vinted', url: `https://www.vinted.com/catalog?search_text=${encoded}` });
      }
      return links;
    }
  };

  // CPU
  items.push({
    name: spec.cpu_suggestion || 'CPU (see recommendation)',
    category: 'cpu',
    estimated_price: toCurrency(estimateCPUPrice(spec.total_cpu_cores)),
    priority: 'essential',
    purchase_links: getLinks(spec.cpu_suggestion, 'cpu'),
  });

  // RAM
  const ramGB = nextPow2(Math.ceil(spec.total_ram_mb / 1024));
  items.push({
    name: `${ramGB} GB DDR4 RAM`,
    category: 'ram',
    estimated_price: toCurrency(ramGB * 80),
    priority: 'essential',
    purchase_links: getLinks(`${ramGB}GB DDR4 RAM`, 'ram'),
  });

  // Storage
  const storageGB = nextPow2(Math.max(spec.total_storage_gb, 128));
  items.push({
    name: `${storageGB} GB NVMe SSD`,
    category: 'storage',
    estimated_price: toCurrency(Math.round(storageGB * 0.6)),
    priority: 'essential',
    purchase_links: getLinks(`${storageGB}GB NVMe SSD`, 'storage'),
  });

  // Case
  items.push({
    name: spec.total_cpu_cores <= 4 ? 'Mini PC Case (compact)' : 'Micro-ATX Case + 450W PSU',
    category: 'case',
    estimated_price: toCurrency(spec.total_cpu_cores <= 4 ? 200 : 350),
    priority: 'essential',
    purchase_links: getLinks(spec.total_cpu_cores <= 4 ? 'mini ITX case' : 'micro ATX case PSU', 'case'),
  });

  // Network cable
  items.push({
    name: 'Ethernet Cable CAT6 (2m)',
    category: 'network',
    estimated_price: toCurrency(20),
    priority: 'essential',
    purchase_links: getLinks('ethernet cable cat6', 'network'),
  });

  // USB for OS
  items.push({
    name: 'USB Flash Drive 16GB (for OS installation)',
    category: 'accessories',
    estimated_price: toCurrency(25),
    priority: 'optional',
    purchase_links: getLinks('usb flash drive 16GB', 'accessories'),
  });

  return items;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function estimateCPUPrice(cores: number): number {
  if (cores <= 2) return 400;
  if (cores <= 4) return 600;
  if (cores <= 8) return 900;
  return 1200;
}

export default ShoppingListPage;
