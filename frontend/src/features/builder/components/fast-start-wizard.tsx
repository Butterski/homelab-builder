import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Server, HardDrive, Network, MonitorPlay, Cpu, Box } from 'lucide-react';

interface FastStartWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (goal: string, scale: string) => void;
  isGenerating?: boolean;
}

const GOALS = [
  {
    id: 'media',
    title: 'Media Server',
    desc: 'Plex, Jellyfin, Arr stack',
    icon: <MonitorPlay className="w-8 h-8 text-indigo-500" />,
  },
  {
    id: 'nas',
    title: 'Network Storage',
    desc: 'TrueNAS, OpenMediaVault',
    icon: <HardDrive className="w-8 h-8 text-emerald-500" />,
  },
  {
    id: 'virtualization',
    title: 'Virtualization Lab',
    desc: 'Proxmox, ESXi, heavy VMs',
    icon: <Server className="w-8 h-8 text-blue-500" />,
  },
  {
    id: 'network',
    title: 'Advanced Network',
    desc: 'pfSense, OPNsense, VLANs',
    icon: <Network className="w-8 h-8 text-amber-500" />,
  },
];

const SCALES = [
  {
    id: 'mini',
    title: 'Mini PC / SFF',
    desc: 'Low power, quiet, fits on a desk (e.g. Intel NUC)',
    icon: <Box className="w-8 h-8" />,
  },
  {
    id: 'desktop',
    title: 'Standard Desktop',
    desc: 'Balanced power and expandability',
    icon: <Cpu className="w-8 h-8" />,
  },
  {
    id: 'rack',
    title: 'Rackmount Server',
    desc: 'Enterprise hardware, loud, high capacity',
    icon: <Server className="w-8 h-8" />,
  },
];

export const FastStartWizard: React.FC<FastStartWizardProps> = ({
  isOpen,
  onClose,
  onGenerate,
  isGenerating,
}) => {
  const [step, setStep] = useState(1);
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null);
  const [selectedScale, setSelectedScale] = useState<string | null>(null);

  const handleNext = () => setStep(2);
  const handleBack = () => setStep(1);

  const handleGenerate = () => {
    if (selectedGoal && selectedScale) {
      onGenerate(selectedGoal, selectedScale);
    }
  };

  const reset = () => {
    setStep(1);
    setSelectedGoal(null);
    setSelectedScale(null);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && reset()}>
      <DialogContent className="sm:max-w-175">
        <DialogHeader>
          <DialogTitle>Fast Start Wizard</DialogTitle>
          <DialogDescription>
            Answer two quick questions to auto-generate a baseline homelab architecture.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {step === 1 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
              <h3 className="text-lg font-medium">What is your primary goal?</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {GOALS.map(goal => (
                  <Card
                    key={goal.id}
                    className={`cursor-pointer transition-all hover:border-primary/50 ${selectedGoal === goal.id ? 'border-primary ring-2 ring-primary/20 bg-primary/5' : ''}`}
                    onClick={() => setSelectedGoal(goal.id)}
                  >
                    <CardHeader className="flex flex-row items-center gap-4 pb-2">
                      {goal.icon}
                      <div>
                        <CardTitle className="text-base">{goal.title}</CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <CardDescription>{goal.desc}</CardDescription>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
              <h3 className="text-lg font-medium">What hardware scale are you targeting?</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {SCALES.map(scale => (
                  <Card
                    key={scale.id}
                    className={`cursor-pointer transition-all hover:border-primary/50 flex flex-col items-center text-center ${selectedScale === scale.id ? 'border-primary ring-2 ring-primary/20 bg-primary/5' : ''}`}
                    onClick={() => setSelectedScale(scale.id)}
                  >
                    <CardHeader className="pb-2 flex w-full items-center">
                      <div
                        className={`p-3 rounded-full w-fit ${selectedScale === scale.id ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'}`}
                      >
                        {scale.icon}
                      </div>
                      <CardTitle className="text-base mt-4">{scale.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <CardDescription>{scale.desc}</CardDescription>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between w-full">
          {step === 2 ? (
            <Button variant="outline" onClick={handleBack} disabled={isGenerating}>
              Back
            </Button>
          ) : (
            <div></div>
          )}

          {step === 1 ? (
            <Button onClick={handleNext} disabled={!selectedGoal}>
              Next Step
            </Button>
          ) : (
            <Button onClick={handleGenerate} disabled={!selectedScale || isGenerating}>
              {isGenerating ? 'Generating...' : 'Generate Project'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
