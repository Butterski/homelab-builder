import { Page, PageHeader } from "../../../components/layout/page"
import { SeoMeta } from "../../../components/seo/seo-meta"

export default function PrivacyPolicyPage() {
    return (
        <Page width="narrow" className="pb-24">
            <SeoMeta
                title="Privacy Policy | HLBuilder"
                description="Read how HLBuilder handles Google sign-in profile data, saved homelab builds, browser storage, and account deletion requests."
                path="/privacy"
            />
            <PageHeader title="Privacy Policy" lede="Last updated: March 5, 2025" />
            <div className="max-w-[42rem] pt-8 text-[0.9375rem] leading-7">
                <div className="space-y-8">
                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold">1. What We Collect</h2>
                        <p>When you sign in with Google, we receive and store:</p>
                        <ul className="list-disc pl-6 space-y-1">
                            <li><strong>Name</strong> and <strong>email address</strong> - to identify your account.</li>
                            <li><strong>Profile picture URL</strong> - to display your avatar.</li>
                        </ul>
                        <p>We also store the <strong>builds and configurations</strong> you create within the app, so you can access them later.</p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold">2. How We Use Your Data</h2>
                        <ul className="list-disc pl-6 space-y-1">
                            <li>To provide and maintain your account and saved builds.</li>
                            <li>To display your profile within the app.</li>
                            <li>To improve the service based on aggregate, anonymized usage patterns.</li>
                        </ul>
                        <p>We do <strong>not</strong> sell, rent, or share your personal data with third parties.</p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold">3. Cookies & Local Storage</h2>
                        <p>We use a <strong>JWT token</strong> stored in your browser to keep you logged in. We also use <code>localStorage</code> to save UI preferences (such as sidebar state and theme). No third-party tracking cookies are used.</p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold">4. Data Storage & Security</h2>
                        <p>Your data is stored in a PostgreSQL database hosted on our server. We use HTTPS encryption in transit and follow standard security practices. However, no system is 100% secure - use the service at your own risk.</p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold">5. Your Rights</h2>
                        <p>You can request deletion of your account and all associated data at any time by contacting us. Upon request, we will permanently delete your data within 30 days.</p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold">6. Changes to This Policy</h2>
                        <p>We may update this policy from time to time. Any changes will be reflected on this page with an updated date.</p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-lg font-semibold">7. Contact</h2>
                        <p>If you have questions about this policy, reach out via our <a href="https://github.com/Butterski/homelab-builder" target="_blank" rel="noreferrer" className="app-link">GitHub repository</a>.</p>
                    </section>
                </div>
            </div>
        </Page>
    )
}
