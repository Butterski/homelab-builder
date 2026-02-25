// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ProjectsPage from '../projects-page'
import { BrowserRouter } from 'react-router-dom'
import { buildApi } from '../../api/builds'
import { useAuth } from '../../../admin/hooks/use-auth'

// Mock dependencies
vi.mock('../../../admin/hooks/use-auth', () => ({
    useAuth: vi.fn()
}))

vi.mock('../../api/builds', () => ({
    buildApi: {
        list: vi.fn(),
        create: vi.fn(),
        get: vi.fn(),
        delete: vi.fn(),
        duplicate: vi.fn(),
        update: vi.fn(),
        calculateNetwork: vi.fn(),
        validateNetwork: vi.fn(),
    }
}))

vi.mock('../../../../components/ui/dropdown-menu', () => ({
    DropdownMenu: ({ children }: any) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
    DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
    DropdownMenuItem: ({ children, onClick }: any) => <button onClick={(e) => { e.stopPropagation(); if (onClick) onClick(e); }}>{children}</button>
}))

vi.mock('../store/builder-store', () => ({
    useBuilderStore: vi.fn(() => ({
        loadBuild: vi.fn()
    }))
}))

// Mock URL object methods
const mockCreateObjectURL = vi.fn()
const mockRevokeObjectURL = vi.fn()
URL.createObjectURL = mockCreateObjectURL
URL.revokeObjectURL = mockRevokeObjectURL

describe('ProjectsPage Export Functionality', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockCreateObjectURL.mockReturnValue('blob:fake-url')
        
        // Mock authenticated user
        ;(useAuth as any).mockReturnValue({
            user: { id: '1', email: 'test@example.com' }
        })
    })

    it('exports a project matching the .homelab.json schema', async () => {
        // Mock a project in the database
        const mockBuild = {
            id: 'build-1',
            user_id: '1',
            name: 'Test Project',
            thumbnail: '',
            nodes: [{ id: 'react-flow-1' }],
            edges: [{ id: 'edge-1' }],
            settings: { boughtItems: [], showBought: false },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }

        const mockBuildList = [{ ...mockBuild }]

        ;(buildApi.list as any).mockResolvedValue(mockBuildList)
        ;(buildApi.get as any).mockResolvedValue(mockBuild)

        render(
            <BrowserRouter>
                <ProjectsPage />
            </BrowserRouter>
        )

        // Wait for projects to load
        await waitFor(() => {
            expect(screen.getByText('Test Project')).toBeInTheDocument()
        })

        // Click the Export button directly (Dropdown content is mocked to always render)
        const exportBtn = await screen.findByText(/Export/i)
        fireEvent.click(exportBtn)

        // Verify that a Blob was created (using waitFor since handleExport is now async)
        await waitFor(() => {
            expect(mockCreateObjectURL).toHaveBeenCalledTimes(1)
        })
        
        // Verify the Blob contents
        const blobArg = mockCreateObjectURL.mock.calls[0][0]
        expect(blobArg).toBeInstanceOf(Blob)
        
        const text = await blobArg.text()
        const payload = JSON.parse(text)

        // Verify schema compliance
        expect(payload).toHaveProperty('version', 1)
        expect(payload).toHaveProperty('name', 'Test Project')
        expect(payload).toHaveProperty('exportedAt')
        expect(payload.nodes).toHaveLength(1)
        expect(payload.edges).toHaveLength(1)
        expect(payload).toHaveProperty('boughtItems')
        expect(payload).toHaveProperty('showBought')
    })
})
