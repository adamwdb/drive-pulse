const { createApp, ref, onMounted, watch, computed } = Vue;

createApp({
    setup() {
        const stats = ref(null);
        const health = ref(null);
        const loading = ref(false);
        const error = ref(null);
        const isSyncing = ref(false);
        const isDark = ref(false); // Default to light mode
        const filter = ref('me'); // Default to 'me'
        const currentTab = ref('health'); // 'health' or 'summary'
        const displayScore = ref(0);
        const sharedDisplayScore = ref(0);
        const activeEmail = ref(null);
        const isProfileOpen = ref(false);
        const acknowledgingId = ref(null);
        
        const displayStats = ref({
            asset_count: 0,
            folder_count: 0,
            owned_count: 0,
            shared_count: 0,
            total_size_bytes: 0
        });

        const storagePulse = computed(() => {
            if (!stats.value || !stats.value.mime_type_sizes) return [];
            const groups = {
                'Videos': { size: 0, color: 'bg-pulse-danger' },
                'Images': { size: 0, color: 'bg-pulse-primary' },
                'Documents': { size: 0, color: 'bg-pulse-accent' },
                'Others': { size: 0, color: 'bg-slate-400' }
            };
            const categorizeMime = (m) => {
                if (m.startsWith('video/')) return 'Videos';
                if (m.startsWith('image/')) return 'Images';
                if (['pdf', 'document', 'sheet', 'presentation', 'text'].some(t => m.includes(t))) return 'Documents';
                return 'Others';
            };
            Object.entries(stats.value.mime_type_sizes).forEach(([m, s]) => {
                if (m !== 'application/vnd.google-apps.folder') groups[categorizeMime(m)].size += s;
            });
            const total = stats.value.total_size_bytes || 1;
            return Object.entries(groups).map(([name, data]) => ({
                name, size: data.size, percentage: (data.size / total) * 100, color: data.color
            }));
        });

        const fetchData = async () => {
            if (loading.value) return;
            loading.value = true;
            error.value = null;
            try {
                const [sRes, hRes] = await Promise.all([
                    fetch(`/stats?owner=${filter.value}`),
                    fetch(`/health?owner=${filter.value}`)
                ]);
                
                if (!sRes.ok || !hRes.ok) {
                    const sErr = await sRes.json();
                    const hErr = await hRes.json();
                    throw new Error(sErr.detail || hErr.detail || 'Failed to fetch pulse data');
                }

                const sData = await sRes.json();
                const hData = await hRes.json();
                
                activeEmail.value = sData.my_email;
                
                const severityOrder = { 'Critical': 0, 'High': 1, 'Medium': 2, 'Low': 3 };
                hData.risk_items.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
                
                stats.value = sData;
                health.value = hData;
                
                animateScore(hData.safety_score, displayScore);
                animateScore(hData.shared_safety_score, sharedDisplayScore);
                animateStats(sData);
            } catch (err) {
                console.error(err);
                error.value = err.message;
            } finally {
                loading.value = false;
            }
        };

        const animateStats = (target) => {
            const startVals = { ...displayStats.value };
            const startTime = performance.now();
            const step = (now) => {
                const progress = Math.min((now - startTime) / 800, 1);
                const ease = progress * (2 - progress);
                Object.keys(startVals).forEach(k => {
                    if (target[k] !== undefined) displayStats.value[k] = Math.floor(startVals[k] + (target[k] - startVals[k]) * ease);
                });
                if (progress < 1) requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        };

        const animateScore = (target, refVar) => {
            const start = refVar.value;
            const startTime = performance.now();
            const step = (now) => {
                const progress = Math.min((now - startTime) / 800, 1);
                refVar.value = Math.floor(start + (target - start) * progress);
                if (progress < 1) requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        };

        const toggleTheme = () => {
            isDark.value = !isDark.value;
            document.getElementById('html-root').classList.toggle('dark');
        };

        const syncData = async () => {
            isSyncing.value = true;
            error.value = null;
            try {
                const res = await fetch('/sync', { method: 'POST' });
                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.detail || 'Sync failed');
                }
                await fetchData();
            } catch (err) {
                console.error(err);
                error.value = err.message;
            } finally {
                isSyncing.value = false;
            }
        };

        const openInDrive = (id) => window.open(`https://drive.google.com/open?id=${id}`, '_blank');
        
        const acknowledgeFile = async (id) => {
            acknowledgingId.value = id;
            error.value = null;
            try {
                const res = await fetch(`/files/${id}/acknowledge`, { method: 'POST' });
                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.detail || 'Failed to acknowledge file');
                }
                await fetchData(); // Refresh health score and list
            } catch (err) {
                console.error(err);
                error.value = err.message;
            } finally {
                acknowledgingId.value = null;
            }
        };

        const formatNumber = (num) => (num || 0).toLocaleString();
        const formatBytes = (bytes) => {
            if (!bytes) return '0 Bytes';
            const i = Math.floor(Math.log(bytes) / Math.log(1024));
            return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + ['B', 'KB', 'MB', 'GB', 'TB'][i];
        };

        const handleOutsideClick = (e) => {
            if (isProfileOpen.value && !e.target.closest('.profile-trigger')) {
                isProfileOpen.value = false;
            }
        };

        onMounted(() => {
            fetchData();
            window.addEventListener('click', handleOutsideClick);
        });

        watch(filter, fetchData);

        return { stats, health, loading, error, isSyncing, isDark, filter, currentTab, displayScore, sharedDisplayScore, displayStats, storagePulse, activeEmail, isProfileOpen, acknowledgingId, fetchData, toggleTheme, syncData, openInDrive, acknowledgeFile, formatNumber, formatBytes };
    },
    template: `
        <div class="max-w-5xl mx-auto p-8 relative z-10">
            <!-- Header -->
            <header class="flex justify-between items-center mb-12">
                <div class="flex items-center gap-4">
                    <div class="w-12 h-12 identity-gradient rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/20">
                        <svg class="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    </div>
                    <div>
                        <h1 class="text-3xl font-black tracking-tight text-slate-800 dark:text-white uppercase">Drive Pulse</h1>
                        <div class="relative profile-trigger">
                            <button @click="isProfileOpen = !isProfileOpen" class="flex items-center gap-2 hover:bg-slate-100/50 dark:hover:bg-slate-800/50 p-1 rounded-lg transition-colors -ml-1">
                                <span v-if="activeEmail" class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                <p class="text-slate-400 text-[10px] uppercase font-black tracking-widest">
                                    {{ activeEmail ? 'Active Session' : 'Local Security Audit' }}
                                </p>
                                <svg v-if="activeEmail" class="w-3 h-3 text-slate-400 transition-transform" :class="{'rotate-180': isProfileOpen}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M19 9l-7 7-7-7" /></svg>
                            </button>
                            
                            <!-- Dropdown -->
                            <div v-if="isProfileOpen" class="absolute top-full left-0 mt-2 w-64 glass rounded-2xl shadow-2xl border border-indigo-100 dark:border-indigo-900/30 p-4 z-50 animate__animated animate__fadeInUp animate__faster">
                                <div class="flex items-center gap-3 mb-3">
                                    <div class="w-8 h-8 identity-gradient rounded-lg flex items-center justify-center text-white font-black text-xs uppercase">
                                        {{ activeEmail ? activeEmail[0] : '?' }}
                                    </div>
                                    <div class="overflow-hidden text-left">
                                        <p class="text-[8px] font-black uppercase text-indigo-500 tracking-widest">Signed in as</p>
                                        <p class="text-[11px] font-bold text-slate-700 dark:text-slate-200 truncate">{{ activeEmail }}</p>
                                    </div>
                                </div>
                                <div class="h-px bg-slate-100 dark:bg-slate-800 my-2"></div>
                                <p class="text-[8px] text-slate-400 leading-relaxed uppercase font-black tracking-tighter">
                                    Local security audit: Your data stays private on your machine.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="flex items-center gap-4 bg-white/50 dark:bg-slate-900/50 p-1.5 rounded-2xl border border-indigo-100 dark:border-indigo-900/30 backdrop-blur-sm">
                    <div class="flex bg-slate-200/50 dark:bg-slate-800/50 p-1 rounded-xl mr-2">
                        <button @click="currentTab = 'health'" :class="currentTab === 'health' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600' : 'text-slate-400'" class="px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all">Health</button>
                        <button @click="currentTab = 'summary'" :class="currentTab === 'summary' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600' : 'text-slate-400'" class="px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all">Summary</button>
                    </div>

                    <div class="flex bg-slate-200/50 dark:bg-slate-800/50 p-1 rounded-xl">
                        <button @click="filter = 'me'" :class="filter === 'me' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600' : 'text-slate-400'" class="px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all">My Drive</button>
                        <button @click="filter = 'others'" :class="filter === 'others' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600' : 'text-slate-400'" class="px-4 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all">Shared</button>
                    </div>
                    <button @click="toggleTheme" class="p-2 text-xl hover:scale-110 transition-transform">
                        <span v-if="!isDark">🌙</span><span v-else>☀️</span>
                    </button>
                    <button @click="syncData" :disabled="isSyncing" class="ml-2 identity-gradient text-white px-6 py-2 rounded-2xl text-xs font-black uppercase tracking-widest shadow-lg active:scale-95 disabled:opacity-50 flex items-center gap-2">
                        <svg v-if="isSyncing" class="animate-spin h-3 w-3 text-white" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        {{ isSyncing ? 'Syncing...' : 'Sync' }}
                    </button>
                </div>
            </header>

            <main>
                <!-- Error Message -->
                <div v-if="error" class="mb-8 p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center justify-between animate__animated animate__shakeX">
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg bg-rose-500 flex items-center justify-center text-white shadow-lg shadow-rose-500/20">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                        </div>
                        <div>
                            <p class="text-[10px] font-black uppercase text-rose-500 tracking-widest mb-0.5">System Error</p>
                            <p class="text-sm font-bold text-slate-700 dark:text-slate-200">{{ error }}</p>
                        </div>
                    </div>
                    <button @click="error = null" class="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                <div v-if="loading && !health" class="flex flex-col items-center justify-center py-32 animate-pulse">
                    <div class="w-12 h-12 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mb-4"></div>
                    <p class="text-[10px] font-black uppercase tracking-widest text-indigo-500">Scanning Pulse...</p>
                </div>

                <div v-else-if="health && stats">
                    <!-- HEALTH TAB -->
                    <div v-show="currentTab === 'health'" class="space-y-12 animate__animated animate__fadeIn animate__faster">
                        <div class="grid grid-cols-1 md:grid-cols-12 gap-8 animate__animated animate__fadeIn">
                            <!-- Dynamic Pulse Circle -->
                            <div class="md:col-span-5 glass p-10 rounded-[2.5rem] shadow-xl flex flex-col items-center">
                                <div class="relative w-48 h-48 flex items-center justify-center">
                                    <svg class="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                                        <circle cx="50" cy="50" r="46" stroke="currentColor" stroke-width="6" fill="transparent" class="text-slate-100 dark:text-slate-900" />
                                        <circle cx="50" cy="50" r="46" stroke="url(#p-grad)" stroke-width="8" fill="transparent" 
                                                stroke-dasharray="289" :stroke-dashoffset="289 - (289 * (filter === 'me' ? displayScore : sharedDisplayScore) / 100)"
                                                stroke-linecap="round" class="transition-all duration-1000" />
                                        <defs><linearGradient id="p-grad"><stop offset="0%" stop-color="#6366f1"/><stop offset="100%" stop-color="#a855f7"/></linearGradient></defs>
                                    </svg>
                                    <div class="absolute text-5xl font-black text-slate-800 dark:text-white">{{ filter === 'me' ? displayScore : sharedDisplayScore }}%</div>
                                </div>
                                <div class="mt-6 px-6 py-2 identity-gradient rounded-full text-white text-[10px] font-black uppercase tracking-widest shadow-lg shadow-indigo-500/20">
                                    {{ filter === 'me' ? 'My Drive Health' : 'Shared Asset Health' }}
                                </div>
                            </div>

                            <!-- Dynamic Mini Stats -->
                            <div v-if="filter === 'me'" class="md:col-span-7 grid grid-cols-2 gap-4">
                                <div class="glass p-6 rounded-[1.8rem] border-l-4 border-rose-500"><div class="text-2xl mb-2">🌍</div><h3 class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">My Public Files</h3><p class="text-2xl font-black text-slate-800 dark:text-white">{{ formatNumber(health.risk_counts.owned.public + health.risk_counts.owned.critical) }}</p></div>
                                <div class="glass p-6 rounded-[1.8rem] border-l-4 border-amber-400"><div class="text-2xl mb-2">🔑</div><h3 class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">My External Shares</h3><p class="text-2xl font-black text-slate-800 dark:text-white">{{ formatNumber(health.risk_counts.owned.external) }}</p></div>
                                <div class="glass p-6 rounded-[1.8rem] border-l-4 border-indigo-500"><div class="text-2xl mb-2">⏳</div><h3 class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">My Idle Assets</h3><p class="text-2xl font-black text-slate-800 dark:text-white">{{ formatNumber(health.risk_counts.owned.idle) }}</p></div>
                                <div class="glass p-6 rounded-[1.8rem] border-l-4 border-slate-400"><div class="text-2xl mb-2">🧼</div><h3 class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Stale Data</h3><p class="text-2xl font-black text-slate-800 dark:text-white">{{ formatBytes(health.risk_counts.owned.trash_bytes) }}</p></div>
                            </div>
                            <div v-else class="md:col-span-7 grid grid-cols-2 gap-4">
                                <div class="glass p-6 rounded-[1.8rem] border-l-4 border-rose-500"><div class="text-2xl mb-2">🌍</div><h3 class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Shared Public Files</h3><p class="text-2xl font-black text-slate-800 dark:text-white">{{ formatNumber(health.risk_counts.shared.public + health.risk_counts.shared.critical) }}</p></div>
                                <div class="glass p-6 rounded-[1.8rem] border-l-4 border-slate-400"><div class="text-2xl mb-2">🚿</div><h3 class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Total Shared Items</h3><p class="text-2xl font-black text-slate-800 dark:text-white">{{ formatNumber(health.risk_counts.shared.total) }}</p></div>
                            </div>
                        </div>

                        <section class="glass rounded-[2rem] overflow-hidden border border-slate-200/50 dark:border-slate-800/50 shadow-xl">
                            <div class="p-6 bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-200/50 dark:border-slate-800/50 flex justify-between items-center">
                                <h3 class="text-xs font-black uppercase text-indigo-500">Security Audit Log</h3>
                                <div class="flex items-center gap-4">
                                    <a href="/audit" target="_blank" class="px-4 py-1.5 bg-indigo-500/10 text-indigo-500 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-indigo-500 hover:text-white transition-all inline-block">View Full Explorer</a>
                                    <span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest text-right">Sorted by Severity</span>
                                </div>
                            </div>
                            <div class="overflow-y-auto max-h-[400px]">
                                <table class="w-full text-left">
                                    <thead class="sticky top-0 z-20 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200/50 dark:border-slate-800/50">
                                        <tr class="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                                            <th class="px-8 py-4">Resource Name</th>
                                            <th class="px-8 py-4">Type</th>
                                            <th class="px-8 py-4">Risk Reason</th>
                                            <th class="px-8 py-4">Level</th>
                                            <th class="px-8 py-4 text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                                        <tr v-for="item in health.risk_items" :key="item.id" class="hover:bg-indigo-50/30 dark:hover:bg-indigo-900/10 transition-colors group">
                                            <td class="px-8 py-4">
                                                <div class="flex items-center gap-3">
                                                    <div class="w-2 h-2 rounded-full" :class="{
                                                        'bg-rose-600 animate-pulse': item.severity === 'Critical',
                                                        'bg-rose-400': item.severity === 'High',
                                                        'bg-amber-400': item.severity === 'Medium',
                                                        'bg-slate-400': item.severity === 'Low'
                                                    }"></div>
                                                    <span class="text-sm font-bold text-slate-700 dark:text-slate-200 truncate max-w-[250px]">{{ item.name }}</span>
                                                    <span v-if="!item.is_mine" class="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-400 text-[8px] font-black uppercase rounded">Shared</span>
                                                </div>
                                            </td>
                                            <td class="px-8 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">{{ item.mime_type?.split('.').pop() || 'File' }}</td>
                                            <td class="px-8 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">{{ item.reason }}</td>
                                            <td class="px-8 py-4"><span :class="{'text-rose-600 border-rose-600/30 bg-rose-600/10': item.severity === 'Critical', 'text-rose-400 bg-rose-400/10 border-rose-400/30': item.severity === 'High','text-amber-500 bg-amber-500/10 border-amber-500/20': item.severity === 'Medium'}" class="px-3 py-1 rounded-lg text-[9px] font-black uppercase border">{{ item.severity }}</span></td>
                                            <td class="px-8 py-4 text-right">
                                                <div class="flex items-center justify-end gap-3">
                                                    <button v-if="item.is_mine" @click="acknowledgeFile(item.id)" :disabled="acknowledgingId === item.id" class="p-1.5 rounded-lg text-slate-400 hover:text-emerald-500 hover:bg-emerald-500/10 transition-all border border-transparent disabled:opacity-50" title="Review & Mark Safe">
                                                        <svg v-if="acknowledgingId === item.id" class="animate-spin h-4 w-4 text-emerald-500" viewBox="0 0 24 24">
                                                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                        </svg>
                                                        <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                                                    </button>
                                                    <button @click="openInDrive(item.id)" class="text-indigo-500 font-black uppercase text-[10px] hover:underline">Manage</button>
                                                </div>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </section>

                        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 pb-12">
                            <div class="glass p-5 rounded-2xl border border-indigo-100/30"><div class="text-rose-600 font-black text-[10px] uppercase mb-2 tracking-widest">🔥 Critical</div><p class="text-[11px] text-slate-500 leading-relaxed">Publicly shared with full <b>Editor</b> access. Anyone can delete/change files.</p></div>
                            <div class="glass p-5 rounded-2xl border border-indigo-100/30"><div class="text-rose-400 font-black text-[10px] uppercase mb-2 tracking-widest">🌍 High</div><p class="text-[11px] text-slate-500 leading-relaxed">Publicly shared View-only access. Accessible by any search engine.</p></div>
                            <div class="glass p-5 rounded-2xl border border-indigo-100/30"><div class="text-amber-500 font-black text-[10px] uppercase mb-2 tracking-widest">🔑 Medium</div><p class="text-[11px] text-slate-500 leading-relaxed">Shared with external email addresses outside your trusted domain.</p></div>
                            <div class="glass p-5 rounded-2xl border border-indigo-100/30"><div class="text-indigo-400 font-black text-[10px] uppercase mb-2 tracking-widest">⏳ Low</div><p class="text-[11px] text-slate-500 leading-relaxed">Shared assets that haven't been modified in over 6 months.</p></div>
                        </div>
                    </div>

                    <!-- SUMMARY TAB -->
                    <div v-show="currentTab === 'summary'" class="space-y-12 animate__animated animate__fadeIn animate__faster">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div class="glass p-10 rounded-[2.5rem]">
                                <h3 class="text-xs uppercase font-black text-indigo-500 mb-8 tracking-widest">Storage Distribution</h3>
                                <div class="space-y-10">
                                    <div v-for="item in storagePulse" :key="item.name">
                                        <div class="flex justify-between mb-3 px-1"><span class="font-black text-slate-700 dark:text-slate-200 uppercase text-[10px]">{{ item.name }}</span><span class="text-xs font-black text-slate-800 dark:text-white">{{ formatBytes(item.size) }} ({{ item.percentage.toFixed(1) }}%)</span></div>
                                        <div class="w-full bg-slate-100/50 dark:bg-slate-900/50 h-4 rounded-2xl overflow-hidden p-1 border border-slate-200/30 dark:border-slate-800/50 backdrop-blur-sm">
                                            <div :class="item.color" class="h-full rounded-xl transition-all duration-[1.5s] ease-out shadow-lg relative overflow-hidden" :style="{ width: item.percentage + '%' }"><div class="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent opacity-50"></div></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="flex flex-col justify-between space-y-8">
                                <div class="glass p-10 rounded-[2.5rem] flex-1">
                                    <h3 class="text-xs uppercase font-black text-indigo-500 mb-8 tracking-widest">Asset Inventory</h3>
                                    <div class="grid grid-cols-2 gap-6">
                                        <div class="p-6 bg-white/40 dark:bg-slate-900/40 rounded-[2rem] border border-white/50 dark:border-slate-800 text-center"><div class="text-3xl font-black text-slate-800 dark:text-white mb-1">{{ formatNumber(displayStats.asset_count) }}</div><div class="text-[9px] uppercase font-black text-slate-400">Files</div></div>
                                        <div class="p-6 bg-white/40 dark:bg-slate-900/40 rounded-[2rem] border border-white/50 dark:border-slate-800 text-center"><div class="text-3xl font-black text-slate-800 dark:text-white mb-1">{{ formatNumber(displayStats.folder_count) }}</div><div class="text-[9px] uppercase font-black text-slate-400">Folders</div></div>
                                        <div class="p-6 bg-white/40 dark:bg-slate-900/40 rounded-[2rem] border border-white/50 dark:border-slate-800 text-center"><div class="text-3xl font-black text-emerald-500 mb-1">{{ formatNumber(displayStats.owned_count) }}</div><div class="text-[9px] uppercase font-black text-slate-400">Owned</div></div>
                                        <div class="p-6 bg-white/40 dark:bg-slate-900/40 rounded-[2rem] border border-white/50 dark:border-slate-800 text-center"><div class="text-3xl font-black text-amber-500 mb-1">{{ formatNumber(displayStats.shared_count) }}</div><div class="text-[9px] uppercase font-black text-slate-400">Shared</div></div>
                                    </div>
                                </div>
                                <div class="p-8 identity-gradient rounded-[2.5rem] flex justify-between items-center text-white shadow-2xl relative overflow-hidden group">
                                    <div><div class="text-[10px] font-black uppercase opacity-70 mb-1">Payload</div><div class="text-3xl font-black tracking-tighter">{{ formatBytes(displayStats.total_size_bytes) }}</div></div>
                                    <div class="bg-white/20 p-4 rounded-2xl backdrop-blur-md transition-transform group-hover:scale-110"><svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H4a2 2 0 00-2 2v7m18 0v5a2 2 0 01-2 2H4a2 2 0 01-2-2v-5m18 0h-2M4 13H6m14 0h-2m-14 0H6" /></svg></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    `
}).mount('#app');
