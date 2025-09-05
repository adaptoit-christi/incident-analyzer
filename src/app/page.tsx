// FILE: src/app/page.tsx
'use client';

import { useState, useRef } from 'react';
import Image from 'next/image';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import mammoth from 'mammoth';

type Action = {
  title: string;
  owner?: string;
  priority?: "P1" | "P2" | "P3";
  due_window?: string;
};

type Analysis = {
  csf: {
    Identify: string[];
    Protect: string[];
    Detect: string[];
    Respond: string[];
    Recover: string[];
  };
  timeline: { time?: string; event: string }[];
  severity: "Low" | "Medium" | "High" | "Critical";
  root_cause: string;
  impacted_assets: string[];
  mitre?: string[];
  nist_800_53?: string[];
  customer_safe_summary: string;
  actions: Action[];
};

const CSF_FUNCTIONS = ["Identify", "Protect", "Detect", "Respond", "Recover"] as const;
const CSF_ICONS = {
  Identify: '🔍',
  Protect: '🛡️',
  Detect: '🎯',
  Respond: '⚡',
  Recover: '🔄'
};

export default function Home() {
  const [ticket, setTicket] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState('');
  const analysisRef = useRef<HTMLDivElement>(null);

  // Function to extract text from DOCX files
  const extractTextFromDocx = async (file: File): Promise<string> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      return result.value;
    } catch (error) {
      console.error('Error extracting text from DOCX:', error);
      return `[Error reading ${file.name}: Could not extract text from DOCX file]`;
    }
  };

  // Function to extract text from PDF files
  const extractTextFromPdf = async (file: File): Promise<string> => {
    try {
      // Dynamic import to avoid SSR issues
      const pdfjsLib = await import('pdfjs-dist');
      
      // Set up worker
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.js`;
      
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = '';
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item) => ('str' in item ? item.str : '')).join(' ');
        fullText += pageText + '\n\n';
      }
      
      return fullText.trim();
    } catch (error) {
      console.error('Error extracting text from PDF:', error);
      return `[Error reading ${file.name}: Could not extract text from PDF file]`;
    }
  };

  const handleAnalyze = async () => {
    if (!ticket.trim()) {
      setError('Please enter a ticket description');
      return;
    }

    setLoading(true);
    setError('');
    setAnalysis(null);

    try {
      const attachments = await Promise.all(
        files.map(async (file) => {
          let text = '';
          let mime = file.type || 'application/octet-stream';
          
          if (file.name.endsWith('.docx')) {
            text = await extractTextFromDocx(file);
            mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          } else if (file.name.endsWith('.pdf')) {
            text = await extractTextFromPdf(file);
            mime = 'application/pdf';
          } else if (file.type.startsWith('text/') || 
                     file.name.endsWith('.log') || 
                     file.name.endsWith('.txt') || 
                     file.name.endsWith('.csv')) {
            text = await file.text();
            mime = file.type || 'text/plain';
          } else {
            // Skip unsupported file types
            return null;
          }
          
          return {
            name: file.name,
            mime: mime,
            text: text
          };
        })
      ).then(attachments => attachments.filter(Boolean) as Array<{name: string, mime: string, text: string}>);

      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket, attachments })
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Analysis failed: ${errorData}`);
      }

      const data = await response.json();
      setAnalysis(data.analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
      console.error('Analysis error:', err);
    } finally {
      setLoading(false);
    }
  };

  const downloadCSV = () => {
    if (!analysis) return;

    const csv = [
      ['Title', 'Owner', 'Priority', 'Due Window'],
      ...analysis.actions.map(a => [
        a.title,
        a.owner || '',
        a.priority || '',
        a.due_window || ''
      ])
    ].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'incident-actions.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPDF = async () => {
    if (!analysis || !analysisRef.current) return;

    try {
      // Create a clone of the analysis section for PDF generation
      const element = analysisRef.current;
      
      // Add temporary CSS to prevent page breaks inside cards
      const style = document.createElement('style');
      style.textContent = `
        .pdf-card { 
          page-break-inside: avoid !important; 
          break-inside: avoid !important;
          margin-bottom: 20px !important;
        }
        .pdf-table { 
          page-break-inside: avoid !important; 
          break-inside: avoid !important;
        }
      `;
      document.head.appendChild(style);

      // Add classes to cards for better PDF layout
      const cards = element.querySelectorAll('[style*="borderRadius: \'12px\'"]');
      cards.forEach(card => card.classList.add('pdf-card'));
      
      const tables = element.querySelectorAll('table');
      tables.forEach(table => table.classList.add('pdf-table'));

      const canvas = await html2canvas(element, {
        scale: 2, // Higher resolution
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#F8F9FA',
        scrollX: 0,
        scrollY: 0,
      });

      // Clean up temporary styles and classes
      document.head.removeChild(style);
      cards.forEach(card => card.classList.remove('pdf-card'));
      tables.forEach(table => table.classList.remove('pdf-table'));

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      
      // Calculate dimensions with margins
      const margin = 15; // 15mm margins
      const imgWidth = 210 - (margin * 2); // A4 width minus margins
      const pageHeight = 297 - (margin * 2); // A4 height minus margins  
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      
      let position = margin; // Start with top margin

      // Add first page with margins
      pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      // Add additional pages if needed
      while (heightLeft >= 0) {
        position = margin - (imgHeight - heightLeft); // Account for margins
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', margin, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-');
      pdf.save(`incident-analysis-${timestamp}.pdf`);
    } catch (error) {
      console.error('Error generating PDF:', error);
      alert('Error generating PDF. Please try again.');
    }
  };

  const getSeverityColor = (severity: string) => {
    switch(severity) {
      case 'Critical': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'High': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'Medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'Low': return 'bg-green-500/20 text-green-400 border-green-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const getPriorityColor = (priority?: string) => {
    switch(priority) {
      case 'P1': return 'bg-red-500/20 text-red-400';
      case 'P2': return 'bg-yellow-500/20 text-yellow-400';
      case 'P3': return 'bg-blue-500/20 text-blue-400';
      default: return 'bg-gray-500/20 text-gray-400';
    }
  };

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  return (
    <div style={{ minHeight: '100vh', background: '#F8F9FA', color: '#4E5D6C', position: 'relative' }}>
      {/* Header */}
      <header style={{ 
        background: 'rgba(248, 249, 250, 0.95)', 
        backdropFilter: 'blur(10px)', 
        borderBottom: '1px solid rgba(28, 61, 111, 0.2)',
        boxShadow: '0 2px 4px rgba(28, 61, 111, 0.1)' 
      }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '1rem 2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <Image src="/adaptoit-logo.png" alt="AdapToIT" width={40} height={40} style={{ width: '40px', height: '40px' }} />
              <div>
                <h1 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#1C3D6F', margin: 0 }}>AdapToIT</h1>
                <p style={{ fontSize: '0.875rem', color: '#4E5D6C', margin: 0 }}>Incident Analysis Platform</p>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: '8px', height: '8px', background: '#3FB6A8', borderRadius: '50%', animation: 'pulse 2s infinite' }}></div>
              <span style={{ fontSize: '0.875rem', color: '#4E5D6C' }}>System Online</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
        {/* Hero Section */}
        <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <h2 style={{ 
            fontSize: '2.5rem', 
            fontWeight: '700', 
            background: 'linear-gradient(135deg, #1C3D6F 0%, #3FB6A8 100%)', 
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            marginBottom: '1rem' 
          }}>
            Advanced Incident Analysis
          </h2>
          <p style={{ fontSize: '1.125rem', color: '#4E5D6C', maxWidth: '600px', margin: '0 auto' }}>
            AI-powered security incident analysis with comprehensive NIST framework mapping and actionable insights
          </p>
        </div>

        {/* Analysis Form */}
        <div style={{ 
          background: 'rgba(255, 255, 255, 0.8)', 
          backdropFilter: 'blur(10px)', 
          borderRadius: '16px', 
          border: '1px solid rgba(28, 61, 111, 0.2)',
          padding: '2rem',
          boxShadow: '0 4px 24px rgba(28, 61, 111, 0.1)',
          marginBottom: '2rem'
        }}>
          {/* Incident Description */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', fontSize: '1.125rem', fontWeight: '600', color: '#1C3D6F', marginBottom: '0.75rem' }}>
              📝 Incident Description
            </label>
            <textarea
              value={ticket}
              onChange={(e) => setTicket(e.target.value)}
              placeholder="Describe the security incident, including timeline, affected systems, and observed behaviors..."
              style={{
                width: '100%',
                minHeight: '150px',
                padding: '1rem',
                background: 'rgba(255, 255, 255, 0.9)',
                border: '1px solid rgba(212, 217, 222, 0.8)',
                borderRadius: '8px',
                color: '#4E5D6C',
                fontSize: '0.95rem',
                resize: 'vertical',
                outline: 'none',
                transition: 'all 0.3s'
              }}
              onFocus={(e) => e.target.style.borderColor = '#1C3D6F'}
              onBlur={(e) => e.target.style.borderColor = 'rgba(212, 217, 222, 0.8)'}
            />
          </div>

          {/* File Upload */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', fontSize: '1.125rem', fontWeight: '600', color: '#1C3D6F', marginBottom: '0.75rem' }}>
              📁 Supporting Files
            </label>
            <div style={{
              border: '2px dashed rgba(212, 217, 222, 0.8)',
              borderRadius: '8px',
              padding: '2rem',
              textAlign: 'center',
              background: 'rgba(255, 255, 255, 0.6)',
              cursor: 'pointer',
              transition: 'all 0.3s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.borderColor = '#1C3D6F'}
            onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(212, 217, 222, 0.8)'}>
              <input
                type="file"
                multiple
                accept=".log,.txt,.csv,.docx,.pdf,text/*"
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
                style={{ display: 'none' }}
                id="file-upload"
              />
              <label htmlFor="file-upload" style={{ cursor: 'pointer' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📤</div>
                <p style={{ color: '#4E5D6C', marginBottom: '0.5rem' }}>Click to upload files or drag and drop</p>
                <p style={{ fontSize: '0.875rem', color: '#4E5D6C', opacity: 0.8 }}>Supports: .txt, .log, .csv, .docx, .pdf</p>
              </label>
            </div>
            
            {files.length > 0 && (
              <div style={{ marginTop: '1rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {files.map((file, i) => (
                  <div key={i} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem 1rem',
                    background: 'rgba(28, 61, 111, 0.1)',
                    border: '1px solid rgba(28, 61, 111, 0.3)',
                    borderRadius: '6px'
                  }}>
                    <span>📄</span>
                    <span style={{ fontSize: '0.875rem' }}>{file.name}</span>
                    <button
                      onClick={() => removeFile(i)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#dc2626',
                        cursor: 'pointer',
                        fontSize: '1.2rem'
                      }}
                    >×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Analyze Button */}
          <div style={{ textAlign: 'center' }}>
            <button
              onClick={handleAnalyze}
              disabled={loading}
              style={{
                padding: '1rem 3rem',
                background: loading ? '#D4D9DE' : 'linear-gradient(135deg, #1C3D6F 0%, #3FB6A8 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '1.125rem',
                fontWeight: '600',
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.3s',
                transform: loading ? 'scale(1)' : 'scale(1)',
                opacity: loading ? 0.7 : 1
              }}
              onMouseEnter={(e) => !loading && (e.currentTarget.style.transform = 'scale(1.05)')}
              onMouseLeave={(e) => !loading && (e.currentTarget.style.transform = 'scale(1)')}
            >
              {loading ? '🔄 Analyzing...' : '🔍 Analyze Incident'}
            </button>
          </div>

          {error && (
            <div style={{
              marginTop: '1rem',
              padding: '1rem',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '8px',
              color: '#dc2626',
              textAlign: 'center'
            }}>
              ⚠️ {error}
            </div>
          )}
        </div>

        {/* Analysis Results */}
        {analysis && (
          <div ref={analysisRef} style={{ animation: 'fadeIn 0.5s ease' }}>
            {/* Results Header */}
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: '2rem',
              padding: '1.5rem',
              background: 'rgba(255, 255, 255, 0.9)',
              borderRadius: '12px',
              border: '1px solid rgba(63, 182, 168, 0.4)',
              boxShadow: '0 2px 8px rgba(28, 61, 111, 0.1)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ width: '12px', height: '12px', background: '#3FB6A8', borderRadius: '50%', animation: 'pulse 2s infinite' }}></div>
                <h3 style={{ fontSize: '1.5rem', fontWeight: '600', color: '#1C3D6F' }}>Analysis Complete</h3>
              </div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button
                  onClick={downloadCSV}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: '#3FB6A8',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.3s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#2d9b94'}
                  onMouseLeave={(e) => e.currentTarget.style.background = '#3FB6A8'}
                >
                  📥 CSV
                </button>
                <button
                  onClick={downloadPDF}
                  style={{
                    padding: '0.75rem 1.5rem',
                    background: '#1C3D6F',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.3s'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#0f2a4a'}
                  onMouseLeave={(e) => e.currentTarget.style.background = '#1C3D6F'}
                >
                  📄 PDF
                </button>
              </div>
            </div>

            {/* Incident Overview Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
              {/* Severity Card */}
              <div style={{
                background: 'rgba(255, 255, 255, 0.95)',
                borderRadius: '12px',
                padding: '1.5rem',
                border: '1px solid rgba(59, 130, 246, 0.3)'
              }}>
                <h4 style={{ fontSize: '1.125rem', fontWeight: '600', color: '#60a5fa', marginBottom: '1rem' }}>
                  ⚡ Threat Assessment
                </h4>
                <div className={getSeverityColor(analysis.severity)} style={{
                  display: 'inline-block',
                  padding: '0.5rem 1rem',
                  borderRadius: '6px',
                  fontWeight: '600',
                  marginBottom: '1rem',
                  border: '1px solid'
                }}>
                  {analysis.severity.toUpperCase()} SEVERITY
                </div>
                <div style={{ marginTop: '1rem' }}>
                  <p style={{ fontSize: '0.875rem', color: '#9ca3af', marginBottom: '0.5rem' }}>ROOT CAUSE</p>
                  <p style={{ color: '#e5e7eb' }}>{analysis.root_cause}</p>
                </div>
              </div>

              {/* Impacted Assets Card */}
              <div style={{
                background: 'rgba(255, 255, 255, 0.95)',
                borderRadius: '12px',
                padding: '1.5rem',
                border: '1px solid rgba(59, 130, 246, 0.3)'
              }}>
                <h4 style={{ fontSize: '1.125rem', fontWeight: '600', color: '#60a5fa', marginBottom: '1rem' }}>
                  🎯 Impacted Assets
                </h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {analysis.impacted_assets.map((asset, i) => (
                    <span key={i} style={{
                      padding: '0.25rem 0.75rem',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '4px',
                      fontSize: '0.875rem',
                      color: '#fca5a5'
                    }}>
                      {asset}
                    </span>
                  ))}
                </div>
              </div>

              {/* Customer Summary Card */}
              <div style={{
                background: 'rgba(255, 255, 255, 0.95)',
                borderRadius: '12px',
                padding: '1.5rem',
                border: '1px solid rgba(59, 130, 246, 0.3)'
              }}>
                <h4 style={{ fontSize: '1.125rem', fontWeight: '600', color: '#60a5fa', marginBottom: '1rem' }}>
                  👥 Executive Summary
                </h4>
                <p style={{ color: '#e5e7eb', lineHeight: '1.6' }}>{analysis.customer_safe_summary}</p>
              </div>
            </div>

            {/* NIST CSF Mapping */}
            <div style={{
              background: 'rgba(255, 255, 255, 0.95)',
              borderRadius: '12px',
              padding: '1.5rem',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              marginBottom: '2rem'
            }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: '600', color: '#60a5fa', marginBottom: '1.5rem' }}>
                🏛️ NIST Cybersecurity Framework Mapping
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                {CSF_FUNCTIONS.map(func => (
                  <div key={func} style={{
                    background: 'rgba(255, 255, 255, 0.95)',
                    borderRadius: '8px',
                    padding: '1rem',
                    borderLeft: '3px solid #1C3D6F'
                  }}>
                    <h4 style={{ fontSize: '1rem', fontWeight: '600', color: '#1C3D6F', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {CSF_ICONS[func]} {func}
                    </h4>
                    <ul style={{ listStyle: 'none', padding: 0 }}>
                      {analysis.csf[func].map((item, i) => (
                        <li key={i} style={{ fontSize: '0.875rem', color: '#1a202c', marginBottom: '0.5rem', paddingLeft: '1rem', position: 'relative' }}>
                          <span style={{ position: 'absolute', left: 0 }}>•</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            {/* Controls Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
              {/* NIST 800-53 Controls */}
              {analysis.nist_800_53 && analysis.nist_800_53.length > 0 && (
                <div style={{
                  background: 'rgba(255, 255, 255, 0.95)',
                  borderRadius: '12px',
                  padding: '1.5rem',
                  border: '1px solid rgba(59, 130, 246, 0.3)'
                }}>
                  <h4 style={{ fontSize: '1.125rem', fontWeight: '600', color: '#60a5fa', marginBottom: '1rem' }}>
                    📋 NIST 800-53 Controls
                  </h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {analysis.nist_800_53.map((control, i) => (
                      <span key={i} style={{
                        padding: '0.25rem 0.75rem',
                        background: 'rgba(59, 130, 246, 0.1)',
                        border: '1px solid rgba(59, 130, 246, 0.3)',
                        borderRadius: '4px',
                        fontSize: '0.875rem',
                        color: '#1C3D6F',
                        fontFamily: 'monospace'
                      }}>
                        {control}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* MITRE ATT&CK */}
              {analysis.mitre && analysis.mitre.length > 0 && (
                <div style={{
                  background: 'rgba(255, 255, 255, 0.95)',
                  borderRadius: '12px',
                  padding: '1.5rem',
                  border: '1px solid rgba(59, 130, 246, 0.3)'
                }}>
                  <h4 style={{ fontSize: '1.125rem', fontWeight: '600', color: '#60a5fa', marginBottom: '1rem' }}>
                    ⚔️ MITRE ATT&CK Techniques
                  </h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {analysis.mitre.map((technique, i) => (
                      <span key={i} style={{
                        padding: '0.25rem 0.75rem',
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: '4px',
                        fontSize: '0.875rem',
                        color: '#dc2626'
                      }}>
                        {technique}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Timeline */}
            <div style={{
              background: 'rgba(255, 255, 255, 0.95)',
              borderRadius: '12px',
              padding: '1.5rem',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              marginBottom: '2rem'
            }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: '600', color: '#60a5fa', marginBottom: '1.5rem' }}>
                ⏱️ Incident Timeline
              </h3>
              <div style={{ position: 'relative', paddingLeft: '2rem' }}>
                <div style={{
                  position: 'absolute',
                  left: '0.75rem',
                  top: '0.5rem',
                  bottom: '0.5rem',
                  width: '2px',
                  background: 'rgba(28, 61, 111, 0.3)'
                }}></div>
                {analysis.timeline.map((event, i) => (
                  <div key={i} style={{ position: 'relative', marginBottom: '1rem' }}>
                    <div style={{
                      position: 'absolute',
                      left: '-1.5rem',
                      width: '10px',
                      height: '10px',
                      background: '#1C3D6F',
                      borderRadius: '50%'
                    }}></div>
                    {event.time && (
                      <span style={{
                        fontSize: '0.875rem',
                        color: '#1C3D6F',
                        fontWeight: '600',
                        marginRight: '0.75rem'
                      }}>
                        {event.time}
                      </span>
                    )}
                    <span style={{ color: '#1a202c' }}>{event.event}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Action Items */}
            <div style={{
              background: 'rgba(255, 255, 255, 0.95)',
              borderRadius: '12px',
              padding: '1.5rem',
              border: '1px solid rgba(59, 130, 246, 0.3)'
            }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: '600', color: '#60a5fa', marginBottom: '1.5rem' }}>
                ✅ Remediation Actions
              </h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(212, 217, 222, 0.5)' }}>
                      <th style={{ padding: '0.75rem', textAlign: 'left', color: '#4E5D6C', fontWeight: '600', opacity: 0.8 }}>Action Item</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', color: '#4E5D6C', fontWeight: '600', opacity: 0.8 }}>Owner</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', color: '#4E5D6C', fontWeight: '600', opacity: 0.8 }}>Priority</th>
                      <th style={{ padding: '0.75rem', textAlign: 'left', color: '#4E5D6C', fontWeight: '600', opacity: 0.8 }}>Due Window</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.actions.map((action, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid rgba(212, 217, 222, 0.3)' }}>
                        <td style={{ padding: '0.75rem', color: '#1a202c' }}>{action.title}</td>
                        <td style={{ padding: '0.75rem', color: '#1a202c' }}>{action.owner || '-'}</td>
                        <td style={{ padding: '0.75rem' }}>
                          {action.priority && (
                            <span className={getPriorityColor(action.priority)} style={{
                              padding: '0.25rem 0.75rem',
                              borderRadius: '4px',
                              fontSize: '0.875rem',
                              fontWeight: '600'
                            }}>
                              {action.priority}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '0.75rem', color: '#1a202c' }}>{action.due_window || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
}