import { GoogleLoginButton } from "../../../components/auth/google-login-button"
import { Hammer, Server, ShoppingCart, CheckSquare } from "lucide-react"
import { Link } from "react-router-dom"

export default function LoginPage() {
    return (
        <div className="flex flex-col items-center justify-center min-h-[80vh] px-4 text-center">
            <div className="mb-8 p-4 bg-primary/10 rounded-2xl">
                <Hammer className="h-16 w-16 text-primary" />
            </div>
            
            <h1 className="text-4xl font-bold tracking-tight mb-3">Homelab Builder</h1>
            <p className="text-xl text-muted-foreground max-w-md mb-8">
                Design, plan, and generate configuration for your dream homelab in minutes.
            </p>

            <div className="w-full max-w-sm bg-card border rounded-xl p-8 shadow-sm">
                <h2 className="font-semibold text-lg mb-6">Sign in to continue</h2>
                <div className="flex justify-center">
                    <GoogleLoginButton />
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-16 max-w-4xl text-left">
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
            </div>
        </div>
    )
}
