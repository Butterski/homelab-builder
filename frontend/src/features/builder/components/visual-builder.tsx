import { useState, useCallback, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    ReactFlow,
    Background,
    Controls,
    useReactFlow,
    type NodeTypes,
    ReactFlowProvider,
    Panel,
    ConnectionMode,
} from '@xyflow/react';
import { toast } from "sonner";
import '@xyflow/react/dist/style.css';
import Joyride, { type CallBackProps, STATUS, type Step } from 'react-joyride';
import { useBuilderStore } from '../store/builder-store';
import { HardwareToolbox } from './hardware-toolbox';
import { HardwareNode as HardwareNodeComponent } from './hardware-node';
import { NodePropertiesPanel } from './node-properties-panel';
import { ComponentDetailsDialog } from './component-details-dialog';
import { LiveResourceDashboard } from './live-resource-dashboard';
import { Button } from '../../../components/ui/button';
import { Wand2, Menu, Save, Folder, Download, LogOut, Route } from 'lucide-react';
import type { HardwareType, HardwareNode } from '../../../types';
import { buildApi } from '../api/builds';
import { useAuth } from '../../admin/hooks/use-auth';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";

import { CustomEdge } from './custom-edge';

const nodeTypes: NodeTypes = {
    hardware: HardwareNodeComponent
};

const edgeTypes = {
    custom: CustomEdge,
};

function ShortcutHints() {
    return (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-3 py-1.5 rounded-full bg-card border border-border text-[10px] text-muted-foreground pointer-events-none select-none">
            <span><kbd className="font-mono bg-muted px-1 rounded">Del</kbd> delete</span>
            <span className="opacity-30">·</span>
            <span><kbd className="font-mono bg-muted px-1 rounded">Ctrl+D</kbd> duplicate</span>
            <span className="opacity-30">·</span>
            <span><kbd className="font-mono bg-muted px-1 rounded">Esc</kbd> deselect</span>
        </div>
    )
}

function Flow() {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const { logout, updatePreferences } = useAuth();

    // Joyride Tour State
    const [runTour, setRunTour] = useState(false);
    const [tourSteps] = useState<Step[]>([
        {
            target: '.tour-toolbox',
            content: 'Welcome to HLBuilder! Drag networking gear and servers from this toolbox onto your canvas.',
            disableBeacon: true,
        },
        {
            target: '.react-flow__pane',
            content: 'Hover over a device to reveal its network ports. Drag a cable from one port to another to connect them.',
        },
        {
            target: '.tour-toolbox-services',
            content: 'Switch to the Services tab. You can drag applications (like Docker, Nextcloud) directly INTO a Server node to deploy them.',
        },
        {
            target: '.tour-properties',
            content: 'Click any device on the canvas to configure its IPs, hardware specs, and passwords in this properties panel.',
        }
    ]);

    useEffect(() => {
        const hasSeenTour = localStorage.getItem('hlb_has_seen_tour');
        if (!hasSeenTour) {
            setRunTour(true);
        }
    }, []);

    const handleJoyrideCallback = (data: CallBackProps) => {
        const { status } = data;
        if ([STATUS.FINISHED, STATUS.SKIPPED].includes(status as any)) {
            setRunTour(false);
            localStorage.setItem('hlb_has_seen_tour', 'true');
        }
    };

    const {
        nodes,
        edges,
        onNodesChange,
        onEdgesChange,
        onConnect,
        addHardware,
        removeHardware,
        duplicateHardware,
        selectNode,
        selectedNodeId,
        addInternalComponent,
        addVM,
        reassignAllIPs,
        loadBuild,
        getBuildData,
        currentBuildId,
        hardwareNodes,
        projectName,
        validateNetwork,
        edgePreferences,
        setEdgePreferences
    } = useBuilderStore();

    const { screenToFlowPosition, getIntersectingNodes } = useReactFlow();

    useEffect(() => {
        if (id && id !== currentBuildId) {
            buildApi.get(id).then(build => {
                loadBuild(build.id, build.name, build);
            }).catch(err => {
                console.error("Failed to load build", err);
                useBuilderStore.getState().clearCurrentBuild();
                navigate('/');
            });
        }
    }, [id, currentBuildId, loadBuild, navigate]);

    const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
    const isFirstRender = useRef(true);
    const lastSaveTime = useRef(Date.now());

    // Effect to mark as "saved" initially when data loads
    useEffect(() => {
        setSaveStatus('saved');
    }, [currentBuildId]);

    const saveProject = useCallback(async () => {
        if (!id) return;
        setSaveStatus('saving');
        try {
            const data = getBuildData();
            await buildApi.update(id, {
                name: projectName || "Untitled Project", // Use store name
                thumbnail: "",
                ...data
            });
            setSaveStatus('saved');
            lastSaveTime.current = Date.now();
            
            // Trigger automatic validation after the changes have been safely persisted
            await validateNetwork();
        } catch (err) {
            console.error("Failed to save", err);
            setSaveStatus('error');
            toast.error("Failed to auto-save");
        }
    }, [id, getBuildData, projectName, validateNetwork]);

    // Auto-save trigger
    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }

        // Debounce save
        const timer = setTimeout(() => {
            saveProject();
        }, 2000); // 2 seconds debounce

        return () => clearTimeout(timer);
    }, [nodes, edges, hardwareNodes, saveProject]); // Any change triggers debounce

    // Manual save wrapper (immediate)
    const handleManualSave = () => {
        toast.promise(saveProject(), {
            loading: 'Saving...',
            success: 'Project saved',
            error: 'Failed to save'
        });
    };

    const { getEdges, deleteElements } = useReactFlow();

    const handlePrefChange = (key: string, val: string) => {
        setEdgePreferences({ [key]: val });
        // @ts-ignore - useAuth user preferences object might be untyped in this strict context
        if (updatePreferences) updatePreferences({ edgePreferences: { ...edgePreferences, [key]: val } });
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement).tagName
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                handleManualSave();
                return;
            }

            if (e.key === 'Delete' || e.key === 'Backspace') {
                const selectedEdges = getEdges().filter(edge => edge.selected);
                if (selectedEdges.length > 0) {
                    e.preventDefault();
                    deleteElements({ edges: selectedEdges });
                    return;
                }

                if (selectedNodeId) {
                    e.preventDefault();
                    removeHardware(selectedNodeId);
                    return;
                }
            }

            if (e.key === 'd' && (e.ctrlKey || e.metaKey) && selectedNodeId) {
                e.preventDefault()
                duplicateHardware(selectedNodeId)
                return
            }

            if (e.key === 'Escape') {
                selectNode(null)
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [selectedNodeId, removeHardware, duplicateHardware, selectNode, handleManualSave, getEdges, deleteElements])

    const onDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    const [pendingComponent, setPendingComponent] = useState<{ nodeId: string, type: HardwareType, name?: string, details?: any } | null>(null);
    const [pendingNode, setPendingNode] = useState<{ type: HardwareType, position: { x: number, y: number } } | null>(null);

    const handleComponentConfirm = (data: { name: string, details: any }) => {
        if (pendingComponent) {
            addInternalComponent(pendingComponent.nodeId, {
                id: `comp-${Date.now()}`,
                type: pendingComponent.type,
                name: data.name,
                details: data.details
            });
            setPendingComponent(null);
        } else if (pendingNode) {
            const newNode: HardwareNode = {
                id: `node-${Date.now()}`,
                type: pendingNode.type,
                name: data.name,
                x: pendingNode.position.x,
                y: pendingNode.position.y,
                details: data.details,
                internal_components: [],
                vms: []
            };
            addHardware(newNode);
            setPendingNode(null);
        }
    };

    const onDrop = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault();

            const position = screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
            });

            const intersecting = getIntersectingNodes({
                x: position.x,
                y: position.y,
                width: 1,
                height: 1,
            });

            const targetNode = intersecting[0];

            let data: any = {};
            const dataStr = event.dataTransfer.getData('application/reactflow-data');
            const type = event.dataTransfer.getData('application/reactflow') as HardwareType;
            if (dataStr) {
                try {
                    data = JSON.parse(dataStr);
                } catch (e) { console.error("Failed to parse drop data", e); }
            } else if (type) {
                data = { type, name: `New ${type}` };
            }

            if (!data.type) return;

            const isServiceDrag = event.dataTransfer.getData('service-drag') === 'true';

            if (isServiceDrag) {
                if (targetNode && targetNode.type === 'hardware') {
                    const cpuVal = data.details?.cpu ? Number(data.details.cpu) : undefined
                    const ramVal = data.details?.ram ? Number(data.details.ram) : undefined

                    addVM(targetNode.id, {
                        id: `vm-${Date.now()}`,
                        name: data.name,
                        type: 'container',
                        status: 'running',
                        cpu_cores: cpuVal || undefined,
                        ram_mb: ramVal || undefined,
                    });
                } else {
                    toast.error("Please drag services directly onto a Server or PC node.");
                }
                return;
            }

            // Direct add if it's a preset (has details) OR if it's a known preset structure
            // We check for details.model to assume it's a preset
            if (data.details && Object.keys(data.details).length > 0 && !pendingComponent) {
                 const newNode: HardwareNode = {
                    id: `node-${Date.now()}`,
                    type: data.type as HardwareType,
                    name: data.name,
                    x: position.x,
                    y: position.y,
                    details: data.details,
                    internal_components: [],
                    vms: []
                };
                addHardware(newNode);
                return;
            }

            if (targetNode && targetNode.type === 'hardware') {
                setPendingComponent({
                    nodeId: targetNode.id,
                    type: data.type,
                    name: data.name,
                    details: data.details
                });
                return;
            }

            setPendingNode({
                type: data.type as HardwareType,
                position
            });
        },
        [screenToFlowPosition, getIntersectingNodes, addHardware, addInternalComponent, addVM, setPendingComponent, setPendingNode],
    );

    const isValidConnection = useCallback((connection: any) => {
        const sourceNode = hardwareNodes.find(n => n.id === connection.source);
        const targetNode = hardwareNodes.find(n => n.id === connection.target);
        
        if (!sourceNode || !targetNode) return false;

        // Ensure physical port is not already occupied on the SOURCE side
        const isSourceHandleUsed = edges.some(e => 
            (e.source === connection.source && e.sourceHandle === connection.sourceHandle) ||
            (e.target === connection.source && e.targetHandle === connection.sourceHandle)
        );
        if (isSourceHandleUsed) {
            toast.error("Source port is already in use.");
            return false;
        }

        // Ensure physical port is not already occupied on the TARGET side
        const isTargetHandleUsed = edges.some(e => 
            (e.source === connection.target && e.sourceHandle === connection.targetHandle) ||
            (e.target === connection.target && e.targetHandle === connection.targetHandle)
        );
        if (isTargetHandleUsed) {
            toast.error("Target port is already in use.");
            return false;
        }

        // A router switch and hba can connect to anything
        if (sourceNode.type === 'switch' || sourceNode.type === 'router' ||
            targetNode.type === 'switch' || targetNode.type === 'router' ||
            sourceNode.type === 'hba' || targetNode.type === 'hba') {
            return true;
        }

        // Otherwise (e.g. PC to PC or PC to Server without a switch), it's invalid
        toast.error("Invalid connection. Devices must connect through a Switch or Router.");
        return false;
    }, [hardwareNodes, edges]);

// ...

    return (
        <div className="flex h-full border-b bg-background overflow-hidden relative">
            <Joyride
                steps={tourSteps}
                run={runTour}
                continuous={true}
                showSkipButton={true}
                showProgress={true}
                callback={handleJoyrideCallback}
                styles={{
                    options: {
                        primaryColor: '#f97316',
                        zIndex: 10000,
                    }
                }}
            />

            <div className="tour-toolbox">
                <HardwareToolbox />
            </div>

            <div className="flex-1 h-full relative" ref={reactFlowWrapper}>
                <LiveResourceDashboard />
                
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    isValidConnection={isValidConnection}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    onDragOver={onDragOver}
                    onDrop={onDrop}
                    onNodeClick={(_, node) => {
                        if (node.type === 'hardware') selectNode(node.id)
                        else selectNode(null)
                    }}
                    onPaneClick={() => selectNode(null)}
                    connectionMode={ConnectionMode.Loose}
                    fitView
                    attributionPosition="bottom-right"
                    className="bg-background"
                    defaultEdgeOptions={{
                        type: 'custom',
                        animated: true,
                        style: { stroke: '#3F3F46', strokeWidth: 2 }
                    }}
                    snapToGrid={true}
                    snapGrid={[20, 20]}
                >
                    <Background gap={20} size={1} color="#A1A1AA" style={{ opacity: 0.25 }} />
                    <Controls />
                    
                    <Panel position="top-left" className="flex gap-2 items-center">
                     <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="icon" className="h-10 w-10 bg-card">
                                <Menu className="h-5 w-5" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-56">
                            <DropdownMenuLabel>Project Menu</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={saveProject}>
                                <Save className="mr-2 h-4 w-4" /> Save Project <span className="ml-auto text-xs text-muted-foreground opacity-60">Ctrl+S</span>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => navigate('/')}>
                                <Folder className="mr-2 h-4 w-4" /> My Projects
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate('/generate')}>
                                <Download className="mr-2 h-4 w-4" /> Export / Generate Config
                            </DropdownMenuItem>
                             <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => navigate('/services')}>
                                <Wand2 className="mr-2 h-4 w-4" /> Component Catalog
                            </DropdownMenuItem>
                             <DropdownMenuSeparator />
                             <DropdownMenuItem onClick={logout} className="text-red-500 focus:text-red-500">
                                <LogOut className="mr-2 h-4 w-4" /> Sign Out
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    <div className="flex flex-col">
                        <h2 className="text-sm font-semibold leading-none">{projectName || "HLBuilder"}</h2>
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                            {saveStatus === 'saving' && <span className="text-amber-500 flex items-center gap-1"><span className="animate-spin">⟳</span> Saving...</span>}
                            {saveStatus === 'saved' && <span className="text-green-500 flex items-center gap-1">Cloud Saved</span>}
                            {saveStatus === 'error' && <span className="text-red-500">Save Failed</span>}
                        </span>
                    </div>

                    <Button variant="secondary" onClick={() => reassignAllIPs()} title="Fix IP Conflicts" size="sm" className="h-10 bg-card ml-4">
                        <Wand2 className="mr-2 h-4 w-4" />
                        Reassign IPs
                    </Button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-10 bg-card w-[150px]">
                            <Route className="mr-2 h-4 w-4 shrink-0" />
                            Edge Settings
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-56">
                        
                        <DropdownMenuLabel className="text-xs text-muted-foreground uppercase">Pathing AI</DropdownMenuLabel>
                        <DropdownMenuRadioGroup value={edgePreferences.routingEngine} onValueChange={(v: any) => handlePrefChange('routingEngine', v)}>
                          <DropdownMenuRadioItem value="smart">Smart (Avoids Nodes)</DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="direct">Direct (Flyover)</DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                        
                        <DropdownMenuSeparator />
                        
                        <DropdownMenuLabel className="text-xs text-muted-foreground uppercase">Connection Pins</DropdownMenuLabel>
                        <DropdownMenuRadioGroup value={edgePreferences.connectionStyle} onValueChange={(v: any) => handlePrefChange('connectionStyle', v)}>
                          <DropdownMenuRadioItem value="floating">Floating (Chassis)</DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="strict">Strict (RJ45 Port)</DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>

                        <DropdownMenuSeparator />
                        
                        <DropdownMenuLabel className="text-xs text-muted-foreground uppercase">Line Style</DropdownMenuLabel>
                        <DropdownMenuRadioGroup value={edgePreferences.lineStyle} onValueChange={(v: any) => handlePrefChange('lineStyle', v)}>
                          <DropdownMenuRadioItem value="bezier">Bezier (Curve)</DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="step">Step (Orthogonal)</DropdownMenuRadioItem>
                          <DropdownMenuRadioItem value="straight">Straight (Linear)</DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                        
                      </DropdownMenuContent>
                    </DropdownMenu>
                </Panel>

                <Panel position="top-right" className="tour-properties">
                    {selectedNodeId && <NodePropertiesPanel />}
                </Panel>

                <ShortcutHints />
                </ReactFlow>
            </div>

            <ComponentDetailsDialog
                open={!!pendingComponent}
                onOpenChange={(v) => !v && setPendingComponent(null)}
                initialType={pendingComponent?.type || 'disk'}
                initialName={pendingComponent?.name}
                initialDetails={pendingComponent?.details}
                onConfirm={handleComponentConfirm}
            />

            <ComponentDetailsDialog
                open={!!pendingNode}
                onOpenChange={(v) => !v && setPendingNode(null)}
                initialType={pendingNode?.type || 'server'}
                title="New Node Details"
                onConfirm={handleComponentConfirm}
            />
        </div>
    );
}

export default function VisualBuilderPage() {
    return (
        <ReactFlowProvider>
            <Flow />
        </ReactFlowProvider>
    );
}
