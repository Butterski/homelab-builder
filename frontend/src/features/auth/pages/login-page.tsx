import { GoogleLoginButton } from "../../../components/auth/google-login-button"
import { Server, ShoppingCart, CheckSquare, Globe, Heart, BookOpen } from "lucide-react"
import { Link } from "react-router-dom"
import { AnimatedLogo } from "../../../components/ui/animated-logo"
import { Github } from "../../../components/icons/github"
import { Discord } from "../../../components/icons/discord"
import { BuyMeACoffee } from "../../../components/icons/buymeacoffee"

export default function LoginPage() {
    return (
        <div className="flex flex-col items-center justify-center min-h-[80vh] px-4 text-center">
            <div className="mb-6">
                <AnimatedLogo className="h-32 w-auto text-primary drop-shadow-[0_10px_15px_rgba(0,0,0,0.1)] dark:drop-shadow-[0_10px_15px_rgba(255,255,255,0.05)]" />
            </div>
            
            <h1 className="text-4xl font-bold tracking-tight mb-3">HLBuilder</h1>
            <p className="text-xl text-muted-foreground max-w-md mb-8">
                Design, plan, and generate configuration for your dream homelab in minutes.
            </p>

            <div className="w-full max-w-sm bg-card border rounded-xl p-8">
                <h2 className="font-semibold text-lg mb-6">Sign in to continue</h2>
                <div className="flex justify-center">
                    <GoogleLoginButton />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-8 mt-16 max-w-5xl text-left">
                <div className="space-y-2 opacity-50 cursor-not-allowed" title="Requires Login">
                    <div className="flex items-center gap-2 font-semibold">
                        <Server className="h-5 w-5 text-blue-500" />
                        <span>Visual Builder</span>
                    </div>
                    <p className="text-sm text-muted-foreground">Drag & drop visual editor for your servers, network, and containers.</p>
                </div>
                
                <Link to="/checklist" className="space-y-2 hover:opacity-80 transition-opacity block">
                    <div className="flex items-center gap-2 font-semibold">
                         <CheckSquare className="h-5 w-5 text-green-500" />
                        <span>Setup Guide</span>
                    </div>
                    <p className="text-sm text-muted-foreground">Step-by-step checklist to prepare your hardware and OS securely.</p>
                </Link>

                <Link to="/hardware" className="space-y-2 hover:opacity-80 transition-opacity block">
                    <div className="flex items-center gap-2 font-semibold">
                        <ShoppingCart className="h-5 w-5 text-orange-500" />
                        <span>Hardware Catalog</span>
                    </div>
                    <p className="text-sm text-muted-foreground">Browse 100+ community curated components with specs and pricing.</p>
                </Link>

                <Link to="/how-to-build-a-homelab" className="space-y-2 hover:opacity-80 transition-opacity block">
                    <div className="flex items-center gap-2 font-semibold">
                        <BookOpen className="h-5 w-5 text-cyan-500" />
                        <span>Homelab Guide</span>
                    </div>
                    <p className="text-sm text-muted-foreground">Read a public guide on planning hardware, networking, and using HLBuilder effectively.</p>
                </Link>
            </div>

            <div className="mt-12 flex items-center justify-center gap-5">
                <a href="https://github.com/Butterski/homelab-builder" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors" title="Project Site">
                    <Globe className="h-4 w-4" />
                </a>
                <a href="https://github.com/Butterski" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors" title="GitHub">
                    <Github className="h-4 w-4" />
                </a>
                <a href="https://github.com/sponsors/Butterski" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-pink-500 transition-colors" title="Sponsor">
                    <Heart className="h-4 w-4" />
                </a>
                <a href="https://discord.gg/8PQb2M2fBB" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-indigo-500 transition-colors" title="Discord">
                    <Discord className="h-4 w-4" />
                </a>
                <a href="https://buymeacoffee.com/butterski" target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-yellow-500 transition-colors" title="Buy Me a Coffee">
                    <BuyMeACoffee className="h-4 w-4" />
                </a>
            </div>

            <div className="mt-3 flex items-center justify-center gap-3 text-xs text-muted-foreground/60">
                <Link to="/privacy" className="hover:text-muted-foreground transition-colors">Privacy Policy</Link>
                <span>·</span>
                <Link to="/terms" className="hover:text-muted-foreground transition-colors">Terms of Service</Link>
            </div>
        </div>
    )
}
