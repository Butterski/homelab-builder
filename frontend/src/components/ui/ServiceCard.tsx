
import type { Service } from '../../types';
import './ServiceCard.css';

interface ServiceCardProps {
  service: Service;
  selected: boolean;
  onToggle: (id: string) => void;
}

export function ServiceCard({ service, selected, onToggle }: ServiceCardProps) {
  const req = service.requirements || { recommended_ram_mb: 0, recommended_cpu_cores: 0 };

  return (
    <button
      type="button"
      className={`service-card ${selected ? 'selected' : ''}`}
      onClick={() => onToggle(service.id)}
    >
      <div className="sc-icon-wrapper">
        <span className="sc-icon">{service.icon || '📦'}</span>
        {selected && <div className="sc-check">✓</div>}
      </div>
      
      <div className="sc-content">
        <div className="sc-header">
          <h3 className="sc-title">{service.name}</h3>
          <span className={`badge badge-secondary sc-category`}>{service.category}</span>
        </div>
        
        <p className="sc-desc">{service.description}</p>
        
        <div className="sc-specs">
          <div className="sc-spec" title="RAM">
            <span className="sc-label">MEM</span>
            <span className="sc-val">{req.recommended_ram_mb} MB</span>
          </div>
          <div className="sc-spec" title="CPU">
            <span className="sc-label">CPU</span>
            <span className="sc-val">{req.recommended_cpu_cores} C</span>
          </div>
          {service.docker_support && (
            <div className="sc-spec docker" title="Docker Ready">
              🐳
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
