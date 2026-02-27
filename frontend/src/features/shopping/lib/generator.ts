
import type { Service, HardwareNode, CatalogComponent } from "../../../types"
import { HARDWARE_CATALOG } from "../data/hardware-catalog"
import { linkGenerator, type ShoppingLocale } from "./link-generator"

export interface Offer {
    store: string
    price: number
    currency: "USD" | "PLN" | "EUR"
    condition: "new" | "used"
    url: string
    isMock?: boolean
}

export interface ShoppingItem {
    name: string
    spec?: string          // Human-readable spec line, e.g. "8-core, 32GB RAM, 1TB NVMe"
    category: string
    priority: 'essential' | 'recommended' | 'optional' | 'manual'
    offers: Offer[]
}

// ─── Offer builder ─────────────────────────────────────────────────────────────
// Returns 3 offers: 2 new (different stores) + 1 used (eBay / Allegro used)
function buildOffers(query: string, basePriceEUR: number, locale: ShoppingLocale): Offer[] {
    const offers: Offer[] = []

    if (locale === 'pl-PL') {
        const pricePLN = Math.round(basePriceEUR * 4.3)
        const allegro = linkGenerator.generate('Allegro', query, 'pl-PL')
        const amazonPL = linkGenerator.generate('Amazon', query, 'pl-PL')
        const xkom = linkGenerator.generate('x-kom', query, 'pl-PL')

        offers.push({ store: 'Allegro', price: pricePLN, currency: 'PLN', condition: 'new', url: allegro.url, isMock: true })
        offers.push({ store: 'Amazon.pl', price: Math.round(pricePLN * 1.05), currency: 'PLN', condition: 'new', url: amazonPL.url, isMock: true })
        offers.push({ store: 'x-kom', price: Math.round(pricePLN * 1.02), currency: 'PLN', condition: 'new', url: xkom.url, isMock: true })
        // Allegro used listing
        const allegroUsed = linkGenerator.generate('Allegro', query + ' używany', 'pl-PL')
        offers.push({ store: 'Allegro (Used)', price: Math.round(pricePLN * 0.65), currency: 'PLN', condition: 'used', url: allegroUsed.url, isMock: true })
    } else {
        const amazon = linkGenerator.generate('Amazon', query, 'en-US')
        const ebay = linkGenerator.generate('eBay', query, 'en-US')

        offers.push({ store: 'Amazon (DE)', price: basePriceEUR, currency: 'EUR', condition: 'new', url: amazon.url, isMock: true })
        offers.push({ store: 'Amazon (UK)', price: Math.round(basePriceEUR * 0.97), currency: 'EUR', condition: 'new', url: amazon.url, isMock: true })
        offers.push({ store: 'eBay (Used)', price: Math.round(basePriceEUR * 0.65), currency: 'EUR', condition: 'used', url: ebay.url, isMock: true })
    }

    return offers
}

// ─── Router-specific recommendations ──────────────────────────────────────────
function routerSpec(node: HardwareNode): { name: string; spec: string; price: number } {
    const catalog = HARDWARE_CATALOG['router'] || []
    // Pick recommendation based on node name hint
    const name = node.name.toLowerCase()
    if (name.includes('mikrotik')) {
        return { name: 'MikroTik RB5009UG+S+IN', spec: '4-core ARM, 1GB RAM, 8× GbE + SFP+', price: 220 }
    }
    if (name.includes('pfsense') || name.includes('opnsense')) {
        return { name: 'Protectli VP2420 (pfSense)', spec: '4-core J6412, 8GB RAM, 4× 2.5GbE', price: 320 }
    }
    // Default: Ubiquiti Dream Machine
    const rec = catalog[0]
    return { name: rec?.model ?? 'Ubiquiti Dream Machine Pro', spec: '4-core ARM, 2GB RAM, 8× GbE, SFP+', price: rec?.price_est ?? 379 }
}

function switchSpec(node: HardwareNode): { name: string; spec: string; price: number } {
    const catalog = HARDWARE_CATALOG['switch'] || []
    const name = node.name.toLowerCase()
    if (name.includes('mikrotik')) {
        return { name: 'MikroTik CSS610-8G-2S+IN', spec: '8× GbE + 2× SFP+, managed', price: 99 }
    }
    if (name.includes('tp-link') || name.includes('tplink')) {
        return { name: 'TP-Link TL-SG108PE', spec: '8× GbE PoE, 64W budget', price: 60 }
    }
    const rec = catalog[0]
    return { name: rec?.model ?? 'Ubiquiti USW-Lite-8-PoE', spec: '8× GbE PoE, 52W budget, managed', price: rec?.price_est ?? 109 }
}

function nasSpec(node: HardwareNode): { name: string; spec: string; price: number } {
    const catalog = HARDWARE_CATALOG['nas'] || []
    const name = node.name.toLowerCase()
    if (name.includes('qnap')) {
        return { name: 'QNAP TS-464', spec: '4-core N5095, 8GB RAM, 4× SATA + 2× M.2', price: 550 }
    }
    if (name.includes('truenas') || name.includes('diy')) {
        return { name: 'DIY TrueNAS (Jonsbo N1)', spec: 'Custom build, 5× SATA, ITX form factor', price: 450 }
    }
    const rec = catalog[0]
    return { name: rec?.model ?? 'Synology DS923+', spec: 'Ryzen R1600, 4GB RAM, 4× SATA + 2× M.2', price: rec?.price_est ?? 599 }
}

function serverSpec(node: HardwareNode): { name: string; spec: string; price: number } {
    if (node.details?.model) {
        return {
            name: node.details.model,
            spec: [node.details.cpu, node.details.ram, node.details.storage].filter(Boolean).join(', '),
            price: node.details.price_est ?? 200
        }
    }
    const catalog = HARDWARE_CATALOG['server'] || []
    const rec = catalog[0]
    return { name: rec?.model ?? 'Dell PowerEdge R730 (Refurb)', spec: '2× Xeon E5-2680v4, 64GB RAM, 2× 1TB SAS', price: rec?.price_est ?? 400 }
}

function accessPointSpec(node: HardwareNode): { name: string; spec: string; price: number } {
    const catalog = HARDWARE_CATALOG['access_point'] || []
    const name = node.name.toLowerCase()
    if (name.includes('tp-link') || name.includes('eap')) {
        return { name: 'TP-Link EAP660 HD', spec: 'WiFi 6, 2.4GHz + 5GHz, 2× GbE uplink', price: 180 }
    }
    const rec = catalog[0]
    return { name: rec?.model ?? 'Ubiquiti U6 Pro', spec: 'WiFi 6, 4× 4 MU-MIMO, PoE powered', price: rec?.price_est ?? 159 }
}

// ─── Main generator ────────────────────────────────────────────────────────────
export function generateShoppingList(
    services: Service[],
    hardwareNodes: HardwareNode[] = [],
    locale: ShoppingLocale = 'en-US',
    catalog: CatalogComponent[] = []
): ShoppingItem[] {
    const items: ShoppingItem[] = []

    const totalRam = services.reduce((acc, s) => acc + (s.requirements?.min_ram_mb || 0), 0)
    const totalStorage = services.reduce((acc, s) => acc + (s.requirements?.min_storage_gb || 0), 0)
    const totalCpu = services.reduce((acc, s) => acc + (s.requirements?.min_cpu_cores || 0), 0)

    const hasExplicitCompute = hardwareNodes.some(n => n.type === 'server' || n.type === 'pc')

    // ── Auto-compute (only when no explicit server/pc in builder) ──────────────
    if (!hasExplicitCompute) {
        let computeName = "Mini PC Intel N100"
        let computeSpec = "4-core N100, 8GB RAM, 256GB NVMe"
        let basePrice = 160

        if (totalCpu > 8 || totalRam > 16384) {
            computeName = "Dell Optiplex Micro i5-8500T"
            computeSpec = "6-core i5-8500T, 16GB RAM, 512GB NVMe"
            basePrice = 250
        } else if (totalCpu > 4) {
            computeName = "Lenovo ThinkCentre Tiny Ryzen 5"
            computeSpec = "6-core Ryzen 5 5600T, 16GB RAM, 512GB NVMe"
            basePrice = 200
        }

        items.push({
            name: computeName,
            spec: computeSpec,
            category: "Compute",
            priority: "essential",
            offers: buildOffers(computeName, basePrice, locale)
        })

        // RAM
        let ramSize = 8
        if (totalRam > 8192) ramSize = 16
        if (totalRam > 16384) ramSize = 32
        if (totalRam > 32768) ramSize = 64
        const ramName = `DDR4 SODIMM ${ramSize}GB (2× ${ramSize / 2}GB kit)`
        items.push({
            name: ramName,
            spec: `${ramSize}GB DDR4-3200 SODIMM dual-channel`,
            category: "Memory",
            priority: "recommended",
            offers: buildOffers(`DDR4 SODIMM ${ramSize}GB`, 20 + ramSize * 1.5, locale)
        })

        // Storage
        const storageSize = Math.max(512, totalStorage * 1.5)
        const diskLabel = storageSize >= 1000 ? '1TB' : '512GB'
        const diskName = `NVMe SSD ${diskLabel} (M.2 2280)`
        items.push({
            name: diskName,
            spec: `${diskLabel} PCIe 3.0 NVMe, ~3500MB/s read`,
            category: "Storage",
            priority: "essential",
            offers: buildOffers(`NVMe SSD ${diskLabel} M.2`, storageSize >= 1000 ? 60 : 40, locale)
        })
    }

    // ── Hardware nodes from Visual Builder ─────────────────────────────────────
    hardwareNodes.forEach(node => {
        let rec: { name: string; spec: string; price: number }

        switch (node.type) {
            case 'router': rec = routerSpec(node); break
            case 'switch': rec = switchSpec(node); break
            case 'nas': rec = nasSpec(node); break
            case 'server': rec = serverSpec(node); break
            case 'pc': rec = serverSpec(node); break
            case 'access_point': rec = accessPointSpec(node); break
            default:
                rec = { name: node.name, spec: 'Custom hardware', price: 100 }
        }

        items.push({
            name: rec.name,
            spec: rec.spec,
            category: node.type.charAt(0).toUpperCase() + node.type.slice(1).replace('_', ' '),
            priority: "manual",
            offers: buildOffers(rec.name, rec.price, locale)
        })
    })

    // Now, enrich standard generated items with real catalog proxy URLs if they exist!
    for (const item of items) {
        // Try to find a match in the real catalog by checking type and name
        const match = catalog.find(c => {
            const tMatch = c.category?.toLowerCase() === item.category.toLowerCase()
            const nMatch = item.name.toLowerCase().includes(c.model.toLowerCase())
            return tMatch && nMatch && c.buy_urls?.length > 0;
        })

        if (match) {
            // Replace offers completely with mapped buy_urls from the database!
            item.offers = match.buy_urls.map(urlObj => ({
                store: urlObj.store,
                price: match.price_est, // estimate
                currency: match.currency as any,
                condition: 'new',
                url: urlObj.url,
                isMock: false
            }))
        }
    }

    return items
}
