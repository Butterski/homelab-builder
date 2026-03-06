import { useState } from 'react';
import { useBuilderStore } from '../store/builder-store';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import {
  Cpu,
  HardDrive,
  MemoryStick,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import VisualBuilder from '../components/visual-builder';
import { cn } from '../../../lib/utils';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../services/api';
import type { CatalogComponent } from '../../../types';

export default function RecommendationsPage() {
  const { hardwareNodes } = useBuilderStore();
  const navigate = useNavigate();
  const [showInsights, setShowInsights] = useState(false);

  // Extract all deployed service IDs from nodes
  const serviceIds = hardwareNodes.flatMap(n => n.vms?.map(vm => vm.id) || []);

  const { data: recResponse, isLoading } = useQuery({
    queryKey: ['recommendations', serviceIds],
    queryFn: () => api.getRecommendations(serviceIds).then(res => res.data),
    enabled: serviceIds.length > 0,
  });

  if (hardwareNodes.length === 0 || serviceIds.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center h-[calc(100vh-4rem)]">
        <h2 className="text-2xl font-bold mb-4">No Services Deployed</h2>
        <p className="text-muted-foreground mb-8">
          Please add hardware nodes and deploy some services onto them in the Visual Builder first.
        </p>
        <Button onClick={() => navigate('/builder')}>Go to Builder</Button>
      </div>
    );
  }

  const spec = recResponse?.recommended_spec;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      {/* Header / Insights Toggle */}
      <div className="border-b bg-card z-10 shrink-0">
        <div className="flex items-center justify-between p-4 max-w-7xl mx-auto w-full">
          <div>
            <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
              System Topology
              <span className="text-muted-foreground font-normal text-sm">
                ({hardwareNodes.length} nodes)
              </span>
            </h1>
          </div>
          <div className="flex gap-2">
            <Button
              variant={showInsights ? 'secondary' : 'default'}
              size="sm"
              onClick={() => setShowInsights(!showInsights)}
            >
              {showInsights ? (
                <ChevronUp className="h-4 w-4 mr-2" />
              ) : (
                <ChevronDown className="h-4 w-4 mr-2" />
              )}
              {showInsights ? 'Hide Recommendations' : 'Show Recommendations'}
            </Button>
            {/* <Button size="sm" variant="outline" onClick={() => navigate('/shopping-list')}>
                    Shopping List <ShoppingCart className="ml-2 h-4 w-4" />
                </Button> */}
          </div>
        </div>

        {/* Collapsible Insights Panel */}
        <div
          className={cn(
            'grid xl:grid-cols-2 gap-4 bg-muted/20 border-t transition-all duration-300 ease-in-out px-4 max-w-7xl mx-auto w-full overflow-y-auto',
            showInsights
              ? 'max-h-[60vh] opacity-100 py-4'
              : 'max-h-0 opacity-0 overflow-hidden py-0 border-none',
          )}
        >
          {isLoading && (
            <div className="col-span-1 xl:col-span-2 flex items-center justify-center p-8 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              Analyzing requirements...
            </div>
          )}

          {!isLoading && recResponse && spec && (
            <>
              <div className="space-y-4">
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm">
                      Minimum Requirements for Selected Services
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 pb-3">
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <Cpu className="h-4 w-4" /> CPU
                      </span>
                      <span className="font-bold">{spec.total_cpu_cores.toFixed(1)} Cores</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <MemoryStick className="h-4 w-4" /> RAM
                      </span>
                      <span className="font-bold">{Math.ceil(spec.total_ram_mb / 1024)} GB</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <HardDrive className="h-4 w-4" /> Storage
                      </span>
                      <span className="font-bold">{spec.total_storage_gb} GB</span>
                    </div>
                    <div className="pt-2 mt-2 border-t text-xs text-muted-foreground">
                      {recResponse.heaviest_service}
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-primary/5 border-primary/20">
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm text-primary">
                      Compatibility & Rationale
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 pb-3 text-sm">
                    <p className="text-muted-foreground">{spec.rationale}</p>
                    <div className="flex flex-col gap-2 mt-4 text-xs">
                      {recResponse.insights.slice(0, 3).map(insight => (
                        <div
                          key={insight.name}
                          className="flex gap-2 items-start text-muted-foreground"
                        >
                          <CheckCircle2 className="h-3 w-3 mt-0.5 text-primary shrink-0" />
                          <span>
                            <strong>{insight.name}:</strong> {insight.note}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-4">
                <h3 className="font-semibold text-sm">Top Hardware Matches</h3>
                {spec.hardware_matches && spec.hardware_matches.length > 0 ? (
                  <div className="grid gap-3">
                    {spec.hardware_matches.map((hw: CatalogComponent) => (
                      <Card key={hw.id} className="hover:border-primary/50 transition-colors">
                        <CardContent className="p-4 flex items-center justify-between gap-4">
                          <div>
                            <div className="font-semibold">
                              {hw.brand} {hw.model}
                            </div>
                            <div className="text-xs text-muted-foreground capitalize">
                              {hw.category}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-bold text-primary">
                              ~{hw.price_est} {hw.currency}
                            </div>
                            {hw.buy_urls && hw.buy_urls.length > 0 && (
                              <a
                                href={hw.buy_urls[0].url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center text-xs text-blue-600 hover:underline mt-1"
                              >
                                Buy on {hw.buy_urls[0].store}{' '}
                                <ExternalLink className="w-3 h-3 ml-1" />
                              </a>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground p-4 bg-muted rounded-md text-center">
                    No exact database matches found. Building a custom PC is recommended.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Main Builder Area - Takes remaining space */}
      <div className="flex-1 bg-slate-50 dark:bg-slate-900 overflow-hidden relative">
        <VisualBuilder />
      </div>
    </div>
  );
}
