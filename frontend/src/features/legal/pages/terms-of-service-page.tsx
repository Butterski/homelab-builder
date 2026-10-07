import { Page, PageHeader } from "../../../components/layout/page"
import { SeoMeta } from "../../../components/seo/seo-meta"

export default function TermsOfServicePage() {
    return (
        <Page width="narrow" className="pb-24">
            <SeoMeta
                title="Terms of Service | HLBuilder"
                description="Read the HLBuilder terms for account use, saved builds, acceptable use, beta limitations, and project contact details."
                path="/terms"
            />
            <PageHeader title="Terms of Service" lede="Last updated: March 5, 2025" />
            <div className="max-w-[42rem] pt-8 text-[0.9375rem] leading-7">
                <div className="space-y-8">
                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold">1. Acceptance</h2>
                        <p>By using HLBuilder ("the Service"), you agree to these terms. If you do not agree, please do not use the Service.</p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold">2. Description of Service</h2>
                        <p>HLBuilder is a free, web-based tool for designing homelab network topologies, generating IP assignments, and browsing hardware and service catalogs. The Service is currently in <strong>open beta</strong>.</p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold">3. Accounts</h2>
                        <p>You sign in using Google OAuth. You are responsible for maintaining the security of your Google account. One person, one account - do not share your session.</p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold">4. Acceptable Use</h2>
                        <p>You agree not to:</p>
                        <ul className="list-disc pl-6 space-y-1">
                            <li>Abuse, overload, or disrupt the Service.</li>
                            <li>Attempt to access other users' data or admin features.</li>
                            <li>Use the Service for any unlawful purpose.</li>
                            <li>Scrape or automatically extract data from the Service.</li>
                        </ul>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold">5. User Content</h2>
                        <p>You retain ownership of the builds and configurations you create. We do not claim any rights over your content. We may delete inactive accounts and their data after extended periods of inactivity.</p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold">6. No Warranty</h2>
                        <p>The Service is provided <strong>"as is"</strong> without warranties of any kind. We do not guarantee uptime, data preservation, or accuracy of generated configurations. This is a beta product - expect bugs.</p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold">7. Limitation of Liability</h2>
                        <p>To the fullest extent permitted by law, HLBuilder and its creator shall not be liable for any indirect, incidental, or consequential damages arising from the use of the Service.</p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold">8. Changes</h2>
                        <p>We may modify these terms at any time. Continued use of the Service after changes constitutes acceptance of the new terms.</p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold">9. Contact</h2>
                        <p>Questions? Open an issue on our <a href="https://github.com/Butterski/homelab-builder" target="_blank" rel="noreferrer" className="app-link">GitHub repository</a>.</p>
                    </section>
                </div>
            </div>
        </Page>
    )
}
