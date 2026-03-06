import { Heart, Coffee } from "lucide-react"
import { Github as GithubIcon } from "../../../components/icons/github"

export default function DonatePage() {
    return (
        <div className="flex-1 overflow-y-auto p-6 lg:p-12 relative h-full">
            <div className="mx-auto max-w-3xl space-y-12 pb-24">

                {/* Header */}
                <div className="text-center space-y-4">
                    <div className="inline-flex items-center justify-center p-3 bg-pink-500/10 text-pink-500 rounded-full mb-2">
                        <Heart className="h-8 w-8" />
                    </div>
                    <h1 className="text-4xl font-extrabold tracking-tight">Support HLBuilder</h1>
                    <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                        Love HLBuilder? Consider supporting its development - every bit helps keep the project alive and growing.
                    </p>
                </div>

                {/* The Story */}
                <div className="prose prose-neutral dark:prose-invert max-w-none space-y-6 text-lg/relaxed">
                    <p>
                        Hi, I'm <strong>Miłosz</strong> (Butters/Butterski online). I study and work in IT here in Poland, 
                        and I pour my evenings and weekends into coding, AI, and homelabbing - because that's what I genuinely love.
                    </p>
                    <p>
                        <strong>HLBuilder started as a passion project</strong> - a tool I built because I couldn't find anything 
                        that fit the way homelabbers actually think. It's grown far beyond what I ever expected, thanks to you.
                    </p>
                    <p>
                        Running this beta costs money - servers don't pay for themselves. 
                        <strong> Donations go directly toward:</strong>
                    </p>
                    
                    <ul className="list-disc pl-6 space-y-1">
                        <li>Keeping the beta online and responsive</li>
                        <li>Upgrading to a dedicated server for the 1.0 release</li>
                        <li>AI tools that help me develop features faster</li>
                        <li>And yes - maybe a network card that doesn't crash mid-Overwatch 😅</li>
                    </ul>
                    
                    <p>
                        <em>Full transparency:</em> This project is about <strong>70% "vibecoded" with AI</strong> and 30% 
                        good old-fashioned debugging. Those AI subscriptions add up - but they let me move fast and build things 
                        that would otherwise take months.
                    </p>
                    
                    <div className="bg-primary/5 border border-primary/20 p-4 rounded-xl space-y-2">
                        <p className="font-semibold text-primary m-0">
                            Here's my promise: HLBuilder will stay free and open to everyone, no paywalls or exclusive features. Your support just helps me keep the lights on and the updates coming.
                        </p>
                        <p className="text-sm text-foreground/80 m-0">
                            I'm also available for consulting or custom implementations - if your team or business needs HLBuilder internally, reach out!
                        </p>
                    </div>
                    
                    <div className="flex items-center gap-4 bg-accent/50 p-4 rounded-xl border border-accent">
                        <div className="p-2 bg-background rounded-lg shrink-0">🏠</div>
                        <p className="m-0 text-base">
                            On a personal note: I'm currently renovating my house (a homelab of a different kind!). 
                            If you'd like to help a dev build both digital and physical infrastructure - every coffee counts. ❤️
                        </p>
                    </div>
                </div>

                {/* Donate Buttons */}
                <div className="grid sm:grid-cols-2 gap-4 pt-4 border-t">
                    <a
                        href="https://buymeacoffee.com/butterski"
                        target="_blank"
                        rel="noreferrer"
                        className="group relative overflow-hidden rounded-xl bg-[#FFDD00] p-6 text-[#000000] hover:bg-[#FFDD00]/90 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-[#FFDD00]/20 flex flex-col items-center gap-3"
                    >
                        <Coffee className="h-8 w-8 transition-transform group-hover:scale-110" />
                        <span className="font-bold text-lg">Buy me a coffee</span>
                        <span className="text-sm opacity-75">One-time or monthly</span>
                    </a>

                    <a
                        href="https://github.com/sponsors/Butterski"
                        target="_blank"
                        rel="noreferrer"
                        className="group relative overflow-hidden rounded-xl bg-[#24292F] dark:bg-white p-6 text-white dark:text-[#24292F] hover:bg-[#24292F]/90 dark:hover:bg-white/90 transition-all hover:-translate-y-1 hover:shadow-xl hover:shadow-black/20 flex flex-col items-center gap-3"
                    >
                        <GithubIcon className="h-8 w-8 transition-transform group-hover:scale-110" />
                        <span className="font-bold text-lg">GitHub Sponsor</span>
                        <span className="text-sm opacity-75">Support development</span>
                    </a>
                </div>
            </div>
        </div>
    )
}