import * as os from 'os';

export interface SystemSpecs {
    totalRamGb: number;
    cpuModel: string;
    isAppleSilicon: boolean;
    isHighEnd: boolean;
    isMidRange: boolean;
    isLowEnd: boolean;
}

export function getSystemSpecs(): SystemSpecs {
    const totalMemBytes = os.totalmem();
    const totalRamGb = totalMemBytes / (1024 * 1024 * 1024);
    
    const cpus = os.cpus();
    const cpuModel = cpus.length > 0 ? cpus[0].model : 'Unknown';
    
    // Detect Apple Silicon (M1, M2, M3, M4, M5, etc.)
    const isAppleSilicon = os.platform() === 'darwin' && 
        (cpuModel.includes('Apple') || os.arch() === 'arm64');

    // Categorization
    // High-end: 24GB+ RAM (Ideal for 20B+ models)
    // Mid-range: 12GB-24GB RAM
    // Low-end: < 12GB RAM
    const isHighEnd = totalRamGb >= 24;
    const isMidRange = totalRamGb >= 12 && totalRamGb < 24;
    const isLowEnd = totalRamGb < 12;

    return {
        totalRamGb,
        cpuModel,
        isAppleSilicon,
        isHighEnd,
        isMidRange,
        isLowEnd
    };
}
