import { Button } from '../../../components/ui/button';
import { ArrowRight, Server, Shield, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-[80vh] items-center justify-center text-center space-y-8 py-12">
      <div className="space-y-4 max-w-3xl">
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl text-primary">
          Build Your Perfect Homelab
        </h1>
        <p className="mx-auto max-w-175 text-lg text-muted-foreground">
          Select the services you want to run, and we'll tell you exactly what hardware you need.
          Stop guessing, start building.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <Button size="lg" asChild>
          <Link to="/services">
            Start Building <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
        <Button size="lg" variant="outline" asChild>
          <Link to="/checklist">View Setup Guide</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-16 text-left max-w-5xl">
        <div className="flex flex-col gap-2 p-6 border rounded-xl hover:border-primary/40 transition-colors">
          <Server className="h-10 w-10 text-primary mb-2" />
          <h3 className="text-xl font-bold">Smart Recommendations</h3>
          <p className="text-muted-foreground">
            Our algorithm analyzes CPU, RAM, and Storage requirements to suggest the best hardware
            tier.
          </p>
        </div>
        <div className="flex flex-col gap-2 p-6 border rounded-xl hover:border-primary/40 transition-colors">
          <Zap className="h-10 w-10 text-primary mb-2" />
          <h3 className="text-xl font-bold">Instant Shopping List</h3>
          <p className="text-muted-foreground">
            Get direct links to purchase compatible hardware locally (Amazon/Allegro).
          </p>
        </div>
        <div className="flex flex-col gap-2 p-6 border rounded-xl hover:border-primary/40 transition-colors">
          <Shield className="h-10 w-10 text-primary mb-2" />
          <h3 className="text-xl font-bold">Secure By Design</h3>
          <p className="text-muted-foreground">
            Follow our best practices guide for styling, security, and maintenance.
          </p>
        </div>
      </div>
    </div>
  );
}
