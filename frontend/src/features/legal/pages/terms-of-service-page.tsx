import { ScrollText } from "lucide-react"

export default function TermsOfServicePage() {
    return (
        <div className="flex-1 overflow-y-auto p-6 lg:p-12 relative h-full">
            <div className="mx-auto max-w-3xl space-y-8 pb-24">
                <div className="space-y-4">
                    <div className="inline-flex items-center justify-center p-3 bg-primary/10 text-primary rounded-full mb-2">
                        <ScrollText className="size-8" />
                    </div>
                    <h1 className="text-4xl font-extrabold tracking-tight">Terms of Service</h1>
                    <p className="text-muted-foreground">Last updated: March 5, 2025</p>
                </div>

                <div className="prose prose-neutral dark:prose-invert max-w-none space-y-6">
                    <section className="space-y-3">
                        <h2 className="text-2xl font-bold">1. Acceptance</h2>
                        <p>By using HLBuilder ("the Service"), you agree to these terms. If you do not agree, please do not use the Service.</p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-2xl font-bold">2. Description of Service</h2>
                        <p>HLBuilder is a free, web-based tool for designing homelab network topologies, generating IP assignments, and browsing hardware and service catalogs. The Service is currently in <strong>open beta</strong>.</p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-2xl font-bold">3. Accounts</h2>
                        <p>You sign in using Google OAuth. You are responsible for maintaining the security of your Google account. One person, one account - do not share your session.</p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-2xl font-bold">4. Acceptable Use</h2>
                        <p>You agree not to:</p>
                        <ul className="list-disc pl-6 space-y-1">
                            <li>Abuse, overload, or disrupt the Service.</li>
                            <li>Attempt to access other users' data or admin features.</li>
                            <li>Use the Service for any unlawful purpose.</li>
                            <li>Scrape or automatically extract data from the Service.</li>
                        </ul>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-2xl font-bold">5. User Content</h2>
                        <p>You retain ownership of the builds and configurations you create. We do not claim any rights over your content. We may delete inactive accounts and their data after extended periods of inactivity.</p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-2xl font-bold">6. No Warranty</h2>
                        <p>The Service is provided <strong>"as is"</strong> without warranties of any kind. We do not guarantee uptime, data preservation, or accuracy of generated configurations. This is a beta product - expect bugs.</p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-2xl font-bold">7. Limitation of Liability</h2>
                        <p>To the fullest extent permitted by law, HLBuilder and its creator shall not be liable for any indirect, incidental, or consequential damages arising from the use of the Service.</p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-2xl font-bold">8. Changes</h2>
                        <p>We may modify these terms at any time. Continued use of the Service after changes constitutes acceptance of the new terms.</p>
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-2xl font-bold">9. Contact</h2>
                        <p>Questions? Open an issue on our <a href="https://github.com/Butterski/homelab-builder" target="_blank" rel="noreferrer" className="text-primary hover:underline">GitHub repository</a>.</p>
                    </section>
                </div>
            </div>
        </div>
    )
}
