import React, { useState } from 'react';
import { AlertCircle, CheckCircle, Download, Play, Search, Brain, ExternalLink, RefreshCw, XCircle } from 'lucide-react';

const LinkCheckerPro = () => {
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState([]);
  const [domainUrl, setDomainUrl] = useState('https://best10homewarranties.com/');
  const [filter, setFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('priority');
  const [healthScore, setHealthScore] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [scanProgress, setScanProgress] = useState('');
  const [expandedScreenshot, setExpandedScreenshot] = useState(null);

  const BACKEND_URL = process.env.REACT_APP_BACKEND_URL ||
                   (window.location.hostname === 'localhost'
                     ? 'http://localhost:3001'
                     : '');  // Empty string = same origin

  // Start real scan
  const startScan = async () => {
    setScanning(true);
    setResults([]);
    setHealthScore(null);
    setStats(null);
    setError(null);
    setScanProgress('Initializing scan...');

    try {
      setScanProgress('Crawling website and discovering pages...');

      const response = await fetch(`${BACKEND_URL}/api/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domainUrl })
      });

      if (!response.ok) {
        throw new Error(`Scan failed: ${response.statusText}`);
      }

      setScanProgress('Analyzing links with AI...');
      const data = await response.json();

      setHealthScore(data.healthScore);
      setStats(data.stats);
      setResults(data.results);
      setScanProgress('Scan complete!');

    } catch (err) {
      setError(err.message);
      console.error('Scan error:', err);
    } finally {
      setScanning(false);
      setTimeout(() => setScanProgress(''), 2000);
    }
  };

  // Filter and sort results
  const filteredResults = results
    .filter(r => {
      if (filter === 'all') return true;
      if (filter === 'critical') return r.priority === 'Critical';
      if (filter === 'high') return r.priority === 'High';
      if (filter === 'medium') return r.priority === 'Medium';
      return true;
    })
    .filter(r => {
      if (!searchTerm) return true;
      const search = searchTerm.toLowerCase();
      return r.linkText.toLowerCase().includes(search) ||
             r.linkUrl.toLowerCase().includes(search) ||
             r.pageUrl.toLowerCase().includes(search) ||
             r.type.toLowerCase().includes(search);
    })
    .sort((a, b) => {
      if (sortBy === 'priority') {
        const priorityOrder = { 'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      if (sortBy === 'impact') return b.impactScore - a.impactScore;
      if (sortBy === 'appearances') return b.appearancesCount - a.appearancesCount;
      return 0;
    });

  // Export to CSV
  const exportToCSV = () => {
    const headers = [
      'Priority', 'Type', 'Status', 'Link Text', 'Link URL', 'Page URL',
      'Context', 'AI Analysis', 'Suggested Fix', 'Impact Score',
      'Appearances', 'Response Time', 'Has Screenshot'
    ];

    const rows = filteredResults.map(r => [
      r.priority,
      r.type,
      r.status,
      r.linkText,
      r.linkUrl,
      r.pageUrl,
      r.context,
      r.aiAnalysis,
      r.suggestedFix || 'N/A',
      r.impactScore,
      r.appearancesCount,
      r.responseTime ? `${r.responseTime}ms` : 'N/A',
      r.screenshot ? 'Yes' : 'No'
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `link-checker-report-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Export to JSON
  const exportToJSON = () => {
    const exportData = {
      scanDate: new Date().toISOString(),
      domain: domainUrl,
      healthScore,
      stats,
      results: filteredResults
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `link-checker-report-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Download all screenshots as ZIP (simplified version - downloads individually)
  const downloadAllScreenshots = () => {
    const screenshotResults = filteredResults.filter(r => r.screenshot);

    if (screenshotResults.length === 0) {
      alert('No screenshots available');
      return;
    }

    screenshotResults.forEach((result, index) => {
      const link = document.createElement('a');
      link.href = `data:image/png;base64,${result.screenshot}`;
      link.download = `error-${index + 1}-${result.linkText.substring(0, 30).replace(/[^a-z0-9]/gi, '_')}.png`;
      link.click();
    });
  };

  const getPriorityColor = (priority) => {
    switch(priority) {
      case 'Critical': return 'text-red-600 bg-red-50 border-red-200';
      case 'High': return 'text-orange-600 bg-orange-50 border-orange-200';
      case 'Medium': return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getStatusColor = (status) => {
    if (status === 200) return 'text-green-600 bg-green-50';
    if (status === 404) return 'text-red-600 bg-red-50';
    if (status >= 500) return 'text-red-700 bg-red-100';
    if (status >= 400) return 'text-orange-600 bg-orange-50';
    if (status >= 300) return 'text-yellow-600 bg-yellow-50';
    return 'text-gray-600 bg-gray-50';
  };

  const getHealthColor = (score) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 70) return 'text-yellow-600';
    if (score >= 50) return 'text-orange-600';
    return 'text-red-600';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
                <AlertCircle className="text-blue-600" size={32} />
                Advanced Link Checker Pro
              </h1>
              <p className="text-slate-600 mt-1">Link Intelligence & Context Analysis</p>
            </div>
            {healthScore !== null && (
              <div className="text-center bg-white border-2 border-slate-200 rounded-lg p-4">
                <div className={`text-5xl font-bold ${getHealthColor(healthScore)}`}>
                  {healthScore}
                </div>
                <div className="text-sm text-slate-600 mt-1">Health Score</div>
              </div>
            )}
          </div>

          {/* Input and Controls */}
          <div className="flex gap-3">
            <input
              type="text"
              value={domainUrl}
              onChange={(e) => setDomainUrl(e.target.value)}
              placeholder="Enter domain URL (e.g., https://example.com)"
              className="flex-1 px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={scanning}
            />
            <button
              onClick={startScan}
              disabled={scanning}
              className="bg-blue-600 text-white px-8 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed flex items-center gap-2 transition-all"
            >
              {scanning ? (
                <>
                  <RefreshCw className="animate-spin" size={20} />
                  Scanning...
                </>
              ) : (
                <>
                  <Play size={20} />
                  Start Deep Scan
                </>
              )}
            </button>
          </div>

          {/* Progress Status */}
          {scanning && scanProgress && (
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center gap-3">
                <RefreshCw className="animate-spin text-blue-600" size={20} />
                <span className="text-blue-800 font-medium">{scanProgress}</span>
              </div>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
              <XCircle className="text-red-600 flex-shrink-0 mt-0.5" size={20} />
              <div>
                <div className="font-medium text-red-800">Scan Error</div>
                <div className="text-red-700 text-sm mt-1">{error}</div>
                <div className="text-red-600 text-xs mt-2">Make sure the backend server is running on http://localhost:3001</div>
              </div>
            </div>
          )}
        </div>

        {/* Stats Dashboard */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-500">
              <div className="text-2xl font-bold text-slate-800">{stats.totalPages}</div>
              <div className="text-sm text-slate-600">Pages Scanned</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-slate-500">
              <div className="text-2xl font-bold text-slate-800">{stats.totalLinks}</div>
              <div className="text-sm text-slate-600">Total Links</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-red-500">
              <div className="text-2xl font-bold text-red-600">{stats.brokenLinks}</div>
              <div className="text-sm text-slate-600">Issues Found</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-red-600">
              <div className="text-2xl font-bold text-red-600">{stats.criticalIssues}</div>
              <div className="text-sm text-slate-600">Critical</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-orange-500">
              <div className="text-2xl font-bold text-orange-600">{stats.highIssues}</div>
              <div className="text-sm text-slate-600">High Priority</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-blue-600">
              <div className="text-2xl font-bold text-blue-600">{stats.avgImpactScore}</div>
              <div className="text-sm text-slate-600">Avg Impact</div>
            </div>
          </div>
        )}

        {/* Filters and Search */}
        {results.length > 0 && (
          <div className="bg-white rounded-lg shadow-lg p-4 mb-6">
            <div className="flex flex-wrap gap-4 items-center">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={20} />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search links, URLs, types..."
                    className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setFilter('all')}
                  className={`px-4 py-2 rounded-lg font-medium transition-all ${
                    filter === 'all' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  All ({results.length})
                </button>
                <button
                  onClick={() => setFilter('critical')}
                  className={`px-4 py-2 rounded-lg font-medium transition-all ${
                    filter === 'critical' ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Critical ({results.filter(r => r.priority === 'Critical').length})
                </button>
                <button
                  onClick={() => setFilter('high')}
                  className={`px-4 py-2 rounded-lg font-medium transition-all ${
                    filter === 'high' ? 'bg-orange-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  High ({results.filter(r => r.priority === 'High').length})
                </button>
              </div>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="priority">Sort by Priority</option>
                <option value="impact">Sort by Impact Score</option>
                <option value="appearances">Sort by Appearances</option>
              </select>

              <button
                onClick={exportToCSV}
                className="bg-green-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-green-700 flex items-center gap-2 transition-all"
              >
                <Download size={20} />
                Export CSV
              </button>

              <button
                onClick={exportToJSON}
                className="bg-purple-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-purple-700 flex items-center gap-2 transition-all"
              >
                <Download size={20} />
                Export JSON
              </button>

              {filteredResults.some(r => r.screenshot) && (
                <button
                  onClick={downloadAllScreenshots}
                  className="bg-orange-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-orange-700 flex items-center gap-2 transition-all"
                >
                  <Download size={20} />
                  Download Screenshots ({filteredResults.filter(r => r.screenshot).length})
                </button>
              )}
            </div>
          </div>
        )}

        {/* Results Table */}
        {filteredResults.length > 0 && (
          <div className="bg-white rounded-lg shadow-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-800 text-white">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Priority</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Status</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Type</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Link Details</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">AI Analysis</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Impact</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Screenshot</th>
                    <th className="px-4 py-3 text-left text-sm font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredResults.map((result) => (
                    <React.Fragment key={result.id}>
                      <tr className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-4">
                          <span className={`px-3 py-1 rounded-full text-xs font-bold border ${getPriorityColor(result.priority)}`}>
                            {result.priority}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`px-2 py-1 rounded text-xs font-semibold ${getStatusColor(result.status)}`}>
                            {result.status}
                          </span>
                          {result.responseTime > 0 && (
                            <div className="text-xs text-slate-500 mt-1">{result.responseTime}ms</div>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <div className="text-sm font-medium text-slate-800">{result.type}</div>
                          {result.redirectCount > 0 && (
                            <div className="text-xs text-orange-600 mt-1">{result.redirectCount} redirects</div>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <div className="space-y-1 max-w-md">
                            <div className="text-sm font-medium text-slate-800">{result.linkText}</div>
                            <div className="text-xs text-slate-500 break-all">
                              <strong>Link:</strong> {result.linkUrl}
                            </div>
                            {result.finalUrl && result.finalUrl !== result.linkUrl && (
                              <div className="text-xs text-green-600 break-all">
                                <strong>→ Final destination:</strong> {result.finalUrl}
                              </div>
                            )}
                            <div className="text-xs text-slate-400 break-all">Page: {result.pageUrl}</div>
                            <div className="text-xs text-blue-600 italic">{result.context}</div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-start gap-2 max-w-lg">
                            <Brain className="text-purple-600 flex-shrink-0 mt-1" size={16} />
                            <div className="text-sm text-slate-700">{result.aiAnalysis}</div>
                          </div>
                          {result.suggestedFix && (
                            <div className="mt-2 text-xs text-green-700 bg-green-50 p-2 rounded border border-green-200">
                              <strong>💡 Fix:</strong> {result.suggestedFix}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-4 text-center">
                          <div className="text-2xl font-bold text-slate-800">{result.impactScore}</div>
                          <div className="text-xs text-slate-500">{result.appearancesCount} {result.appearancesCount === 1 ? 'page' : 'pages'}</div>
                        </td>
                        <td className="px-4 py-4 text-center">
                          {result.screenshot ? (
                            <button
                              onClick={() => setExpandedScreenshot(expandedScreenshot === result.id ? null : result.id)}
                              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2 mx-auto transition-all"
                            >
                              📸 {expandedScreenshot === result.id ? 'Hide' : 'View'}
                            </button>
                          ) : (
                            <span className="text-slate-400 text-xs">No screenshot</span>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <a
                            href={result.pageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center gap-1 hover:underline"
                          >
                            <ExternalLink size={14} />
                            View Page
                          </a>
                        </td>
                      </tr>
                      {expandedScreenshot === result.id && result.screenshot && (
                        <tr>
                          <td colSpan="8" className="px-4 py-4 bg-slate-50">
                            <div className="max-w-full">
                              <div className="flex justify-between items-center mb-2">
                                <h4 className="font-semibold text-slate-800">Error Screenshot - {result.linkText}</h4>
                                <a
                                  href={`data:image/png;base64,${result.screenshot}`}
                                  download={`error-${result.id}-${result.linkText.substring(0, 30).replace(/[^a-z0-9]/gi, '_')}.png`}
                                  className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                                >
                                  ⬇️ Download
                                </a>
                              </div>
                              <div className="border-2 border-slate-300 rounded-lg overflow-hidden bg-white">
                                <img
                                  src={`data:image/png;base64,${result.screenshot}`}
                                  alt={`Screenshot showing error for ${result.linkText}`}
                                  className="w-full h-auto"
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Results Summary Footer */}
            <div className="bg-slate-50 px-6 py-4 border-t border-slate-200">
              <div className="text-sm text-slate-600">
                Showing <span className="font-bold">{filteredResults.length}</span> of <span className="font-bold">{results.length}</span> issues found
              </div>
            </div>
          </div>
        )}

        {/* Empty State - No Issues */}
        {results.length === 0 && !scanning && healthScore !== null && (
          <div className="bg-white rounded-lg shadow-lg p-12 text-center">
            <CheckCircle className="mx-auto text-green-500 mb-4" size={64} />
            <h3 className="text-2xl font-bold text-slate-800 mb-2">Perfect! No Issues Found</h3>
            <p className="text-slate-600">All links are working correctly on this domain.</p>
          </div>
        )}

        {/* Empty State - Ready to Scan */}
        {results.length === 0 && !scanning && !healthScore && (
          <div className="bg-white rounded-lg shadow-lg p-12 text-center">
            <AlertCircle className="mx-auto text-slate-300 mb-4" size={64} />
            <h3 className="text-xl font-semibold text-slate-800 mb-2">Ready to Scan</h3>
            <p className="text-slate-600 mb-4">Enter a domain URL and click "Start Deep Scan" to begin production-grade link analysis</p>
            <div className="text-sm text-slate-500 bg-slate-50 p-4 rounded-lg inline-block">
              <strong>Backend Required:</strong> Make sure the Node.js server is running on port 3001
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LinkCheckerPro;