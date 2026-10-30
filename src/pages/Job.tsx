import { wrapSocket } from '../e2ee/socket';
import MemberApproval from '../components/MemberApproval';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { io, Socket } from 'socket.io-client';
import { Plus, Receipt, Copy, Check, Image as ImageIcon, DollarSign, Archive, Trash2, ListTree, Link as LinkIcon, RefreshCw, Paperclip, Sparkles, Download, Upload, WifiOff, Wifi, CloudUpload, Briefcase, Calendar, Bot, FileText, Maximize2, X, LogOut, Eye, Lock, ExternalLink, AlertTriangle, Save, Tag as TagIcon } from 'lucide-react';
import { MarkdownRenderer } from '../components/MarkdownRenderer';
import InvoiceGenerator, { InvoiceView, InvoicePreview } from '../components/InvoiceGenerator';
import { motion, AnimatePresence } from 'motion/react';
import { encryptFile, decryptFile } from '../utils/crypto';
import { runLocalOcr } from '../utils/ocr';
import { formatInvoiceNumber, formatInvoiceSequence } from '../utils/invoice';
import BudgetTrendChart from '../components/BudgetTrendChart';
import {
  enqueuePendingExpense,
  getPendingExpensesForJob,
  drainSyncQueue,
  type PendingExpense,
} from '../utils/sync';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';

interface Tag {
  id: string;
  name: string;
  color: string;
}

interface Expense {
  id: string;
  amount: number;
  description: string;
  receipt_url: string | null;
  is_encrypted: number;
  entry_type: 'expense' | 'income';
  user_id: string;
  user_name: string;
  created_at: string;
  tags?: Tag[];
  date?: string;
  /** true while the expense lives only in the local IndexedDB queue */
  pendingSync?: boolean;
  google_event_id?: string | null;
}

interface WishlistItem {
  id: string;
  name: string;
  estimated_cost: number | null;
  url: string | null;
  notes: string | null;
  user_id: string;
  user_name: string;
  created_at: string;
}

const ViewReceiptButton = ({ url, isEncrypted, jobId, jobKey }: { url: string, isEncrypted: number, jobId: string, jobKey: string | null }) => {
  const [loading, setLoading] = useState(false);

  const handleView = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isEncrypted) {
      window.open(url, '_blank');
      return;
    }

    let key = jobKey;
    if (!key) {
      const userInput = prompt("Encryption key not found in vault. Please enter the project encryption key to view this receipt:");
      if (!userInput) return;
      key = userInput.trim();
    }

    setLoading(true);
    try {
      const res = await fetch(url);
      const encryptedBlob = await res.blob();
      const decryptedBlob = await decryptFile(encryptedBlob, key, 'image/jpeg');
      const objectUrl = URL.createObjectURL(decryptedBlob);
      window.open(objectUrl, '_blank');
    } catch (err) {
      console.error("Failed to decrypt", err);
      alert("Failed to decrypt receipt. The key might be incorrect.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleView}
      disabled={loading}
      className="inline-flex items-center gap-2 text-xs font-medium text-[#7c3bed] bg-[#7c3bed]/10 hover:bg-[#7c3bed]/20 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
    >
      <ImageIcon className="w-3.5 h-3.5" />
      {loading ? 'Decrypting...' : 'View Receipt'}
    </button>
  );
};

export default function Job() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<any>(null);
  const [jobKey, setJobKey] = useState<string | null>(null);
  
  // Data states
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [wishlistItems, setWishlistItems] = useState<WishlistItem[]>([]);
  const [globalTags, setGlobalTags] = useState<Tag[]>([]);
  
  // UI states
  const [activeTab, setActiveTab] = useState<'entries' | 'wishlist'>('entries');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isWishlistModalOpen, setIsWishlistModalOpen] = useState(false);
  const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
  const [members, setMembers] = useState<any[]>([]);
  const [copied, setCopied] = useState(false);
  
  // Form states - Expense
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [entryType, setEntryType] = useState<'expense' | 'income'>('expense');
  const [receipt, setReceipt] = useState<File | null>(null);
  const [expenseDate, setExpenseDate] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_RECEIPT_BYTES = 15 * 1024 * 1024;
  const reportUploadError = async (res: Response | null, fallback: string) => {
    let msg = fallback;
    if (res) {
      try { msg = (await res.json())?.error || (res.status === 413 ? 'File is too large (max 15 MB).' : fallback); } catch { if (res.status === 413) msg = 'File is too large (max 15 MB).'; }
    }
    alert(msg);
  };

  const handleReceiptFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_RECEIPT_BYTES) {
      alert(`"${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). The maximum receipt size is 15 MB.`);
      return;
    }
    setReceipt(file);
  };

  const handleCameraClick = async () => {
    // Capacitor's camera prompt only works in the native app; in a browser use a normal file picker.
    if (!Capacitor.isNativePlatform()) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const image = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: CameraResultType.Uri,
        source: CameraSource.Prompt
      });
      if (image.webPath) {
        const res = await fetch(image.webPath);
        const blob = await res.blob();
        const fileName = `receipt_${Date.now()}.${image.format}`;
        const file = new File([blob], fileName, { type: `image/${image.format}` });
        setReceipt(file);
      }
    } catch (e) {
      console.error('Camera error', e);
    }
  };

  const [isEditJobModalOpen, setIsEditJobModalOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editMode, setEditMode] = useState<'expense' | 'budget'>('expense');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editSyncExpenses, setEditSyncExpenses] = useState(false);
  
  const [editClientName, setEditClientName] = useState('');
  const [editClientAddress, setEditClientAddress] = useState('');
  const [editClientEmail, setEditClientEmail] = useState('');
  const [editJobRate, setEditJobRate] = useState('');
  const [editInvoiceNotes, setEditInvoiceNotes] = useState('');
  const [editInvoiceNumber, setEditInvoiceNumber] = useState('');
  const [editInvoiceTag, setEditInvoiceTag] = useState('');
  const [editJobError, setEditJobError] = useState('');
  
  const [isEditingJob, setIsEditingJob] = useState(false);

  // Subscriptions
  const [isSubModalOpen, setIsSubModalOpen] = useState(false);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [isRecurring, setIsRecurring] = useState(false);
  const [subscriptionFrequency, setSubscriptionFrequency] = useState('MONTHLY');
  const [remind1Day, setRemind1Day] = useState(false);
  const [remind2Days, setRemind2Days] = useState(false);
  const [remind7Days, setRemind7Days] = useState(false);

  // Inline Tag Creation
  const [isCreatingTag, setIsCreatingTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#7c3bed');

  // Filtering and Sorting
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'>('date_desc');

  // Form states - Wishlist
  const [wishName, setWishName] = useState('');
  const [wishCost, setWishCost] = useState('');
  const [wishUrl, setWishUrl] = useState('');
  const [wishNotes, setWishNotes] = useState('');

  // Attach receipt states
  const [attachingToExId, setAttachingToExId] = useState<string | null>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);

  // Export/Import
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const jsonImportRef = useRef<HTMLInputElement>(null);

  const [aiConfigured, setAiConfigured] = useState(false);
  const [useOnDeviceAi, setUseOnDeviceAi] = useState(false);
  const [onDeviceAiModel, setOnDeviceAiModel] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStatus, setScanStatus] = useState('');
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);
  
  // AI Notes State
  const [isNotesModalOpen, setIsNotesModalOpen] = useState(false);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [editedNotes, setEditedNotes] = useState('');
  const [isSavingNotes, setIsSavingNotes] = useState(false);

  // Invoice States
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [invoiceTemplate, setInvoiceTemplate] = useState<any>(null);
  const [invoiceTotalLaborHours, setInvoiceTotalLaborHours] = useState('0');
  const [invoiceHourlyRate, setInvoiceHourlyRate] = useState('');
  const [invoiceNotes, setInvoiceNotes] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceTag, setInvoiceTag] = useState('');
  const [isSavingInvoice, setIsSavingInvoice] = useState(false);
  const [invoiceModalError, setInvoiceModalError] = useState('');
  const [invoiceModalSuccess, setInvoiceModalSuccess] = useState(false);
  const invoiceRef = useRef<any>(null);

  const navigate = useNavigate();

  const { token, user, masterKey, isVaultLocked } = useAuth();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (token && id && masterKey && !isVaultLocked) {
      fetch(`/api/jobs/${id}/keys`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      .then(res => res.json())
      .then(async data => {
        if (data.key) {
          try {
            const { importEncryptionKey, unwrapKey } = await import('../utils/crypto');
            const mkCrypto = await importEncryptionKey(masterKey);
            const rawJobKey = await unwrapKey(data.key, mkCrypto);
            setJobKey(rawJobKey);
          } catch(e) {
            console.error("Failed to unwrap job key", e);
          }
        } else {
          const local = localStorage.getItem(`job_key_${id}`);
          if (local) setJobKey(local);
        }
      })
      .catch(console.error);
    } else if (id) {
      const local = localStorage.getItem(`job_key_${id}`);
      if (local) setJobKey(local);
    }
  }, [token, id, masterKey, isVaultLocked]);

  // ── Offline Sync ────────────────────────────────────────────────
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  /** Replace a temp-ID expense with the real server version after sync. */
  const handleSyncComplete = useCallback((tempId: string, realExpense: Expense) => {
    setExpenses(prev => prev.map(e => e.id === tempId ? { ...realExpense, pendingSync: false } : e));
    setPendingCount(prev => Math.max(0, prev - 1));
  }, []);

  /** Drain the queue when coming back online. */
  const runSync = useCallback(async () => {
    if (!token) return;
    setIsSyncing(true);
    try {
      await drainSyncQueue(token, handleSyncComplete);
    } finally {
      setIsSyncing(false);
    }
  }, [token, handleSyncComplete]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      runSync();
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [runSync]);

  /** On mount, hydrate pending expenses from IndexedDB into the UI. */
  useEffect(() => {
    if (!id) return;
    getPendingExpensesForJob(id).then(pending => {
      if (pending.length === 0) return;
      setPendingCount(pending.length);
      const optimisticExpenses: Expense[] = pending.map(p => ({
        id: p.tempId,
        amount: parseFloat(p.amount),
        description: p.description,
        entry_type: p.entryType,
        receipt_url: null,
        is_encrypted: 0,
        user_id: '',
        user_name: 'You',
        created_at: new Date(p.queuedAt).toISOString(),
        date: p.date,
        pendingSync: true,
      }));
      setExpenses(prev => {
        const existingIds = new Set(prev.map(e => e.id));
        const newOnes = optimisticExpenses.filter(e => !existingIds.has(e.id));
        return [...newOnes, ...prev];
      });
    });
  }, [id]);

  useEffect(() => {
    fetchJob();
    fetchExpenses();
    fetchWishlist();
    fetchSubscriptions();
    fetchMembers();
    fetchGlobalTags();
    fetchInvoiceTemplate();
    checkAiConfig();

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    socketRef.current = wrapSocket(io(window.location.origin, { auth: { token } }));
    socketRef.current.emit('join_job', id);

    socketRef.current.on('expense_added', (expense: Expense) => {
      setExpenses((prev) => [expense, ...prev]);
    });
    
    socketRef.current.on('expense_updated', (expense: Expense) => {
      setExpenses((prev) => prev.map(e => e.id === expense.id ? expense : e));
    });

    socketRef.current.on('expense_deleted', (expenseId: string) => {
      setExpenses((prev) => prev.filter(e => e.id !== expenseId));
    });

    socketRef.current.on('wishlist_item_added', (item: WishlistItem) => {
      setWishlistItems((prev) => [item, ...prev]);
    });

    socketRef.current.on('wishlist_item_deleted', (itemId: string) => {
      setWishlistItems((prev) => prev.filter(i => i.id !== itemId));
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.emit('leave_job', id);
        socketRef.current.disconnect();
      }
    };
  }, [id]);

  useEffect(() => {
    if (receipt) {
      const url = URL.createObjectURL(receipt);
      setReceiptPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setReceiptPreviewUrl(null);
    }
  }, [receipt]);

  const fetchGlobalTags = async () => {
    const res = await fetch('/api/tags', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setGlobalTags(await res.json());
  };

  useEffect(() => {
    if (isModalOpen) checkAiConfig();
  }, [isModalOpen]);

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!isModalOpen) return;
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1 || items[i].type.indexOf('pdf') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            setReceipt(file);
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [isModalOpen]);

  const fetchJob = async () => {
    const res = await fetch(`/api/jobs/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setJob(await res.json());
  };

  const fetchExpenses = async () => {
    const res = await fetch(`/api/jobs/${id}/expenses`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setExpenses(await res.json());
  };

  const fetchWishlist = async () => {
    const res = await fetch(`/api/jobs/${id}/wishlist`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setWishlistItems(await res.json());
  };

  const fetchInvoiceTemplate = async () => {
    const res = await fetch('/api/invoice-templates', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setInvoiceTemplate(await res.json());
  };

  const fetchSubscriptions = async () => {
    const res = await fetch(`/api/jobs/${id}/subscriptions`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setSubscriptions(await res.json());
  };

  const fetchMembers = async () => {
    const res = await fetch(`/api/jobs/${id}/members`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setMembers(await res.json());
  };

  const checkAiConfig = async () => {
    try {
      const res = await fetch('/api/settings/ai', { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setUseOnDeviceAi(data.use_on_device_ai === 1);
        setOnDeviceAiModel(data.on_device_ai_model || 'Xenova/donut-base-finetuned-cord-v2');
        setAiConfigured(data.use_on_device_ai === 1 || !!data.ai_api_key);
      }
    } catch (e) {}
  };

  const handleAiScan = async () => {
    if (user?.plan === 'free' && !user?.isAdmin) {
      alert("AI Scanning is not available on the Free tier. Please upgrade to unlock Magic Scan.");
      navigate('/pricing');
      return;
    }

    if (!aiConfigured) {
      navigate('/settings#ai-config');
      return;
    }

    if (!receipt) {
      alert("Please select a receipt image first.");
      fileInputRef.current?.click();
      return;
    }

    setIsScanning(true);
    setNeedsVerification(false);
    setScanProgress(0);
    setScanStatus('Preparing...');

    try {
      if (useOnDeviceAi && receiptPreviewUrl) {
        setScanStatus('Loading local model...');
        
        let modelResult;
        try {
          const result = await runLocalOcr(receiptPreviewUrl, onDeviceAiModel, (info) => {
            if (info.status === 'downloading') {
              setScanStatus(`Downloading model (${info.file})...`);
            } else if (info.status === 'init') {
              setScanStatus('Initializing WebGPU...');
            } else if (info.progress) {
              setScanProgress(info.progress);
            }
          });
          modelResult = Array.isArray(result) ? result[0] : result;
        } catch (localErr) {
          console.error(localErr);
          throw new Error("Local OCR failed. Check console or try the API fallback.");
        }

        // Parse logic depends on model
        const text = modelResult?.generated_text || '';
        console.log("RAW LOCAL OCR MODEL OUPUT:\n", text);
        
        // Tesseract gives us raw text. We need to parse amount and a likely merchant
        // Use multi-line matching and word boundaries to prefer "TOTAL" over "SUBTOTAL"
        const amountMatch = text.match(/(?:^|\s)(?:total\b|amount due\b|balance\b)[\s:$#]*([0-9]+\.[0-9]{2})/im);
        if (amountMatch) {
          setAmount(amountMatch[1]);
        } else {
          // Fallback if the strict regex misses, try the looser one
          const looseMatch = text.match(/(?:total|amount|due|balance|usd)[\s:$#]*([0-9]+\.[0-9]{2})/i);
          if (looseMatch) setAmount(looseMatch[1]);
        }
        
        // Find a suitable merchant name/description
        const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 3 && !l.match(/^[0-9\s.*#\-:()]+$/));
        const skipPhrases = [
          'see back of', 'chance to win', 'id #', 'save money', 'live better', 
          'welcome', 'receipt', 'customer', 'cashier', 'store', 'manager'
        ];
        
        const merchantLine = lines.find((l: string) => {
          const lower = l.toLowerCase();
          return !skipPhrases.some(phrase => lower.includes(phrase));
        });
        
        if (merchantLine) {
          setDescription(merchantLine);
        } else if (lines.length > 0) {
          setDescription(lines[0]);
        } else {
          setDescription("DEBUG RAW: " + text.substring(0, 150));
        }
        
        // Extract a date if possible (April 5, 2026 or MM/DD/YYYY)
        const textDateMatch = text.match(/(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,)?\s+\d{4}/i);
        const numericDateMatch = text.match(/(0[1-9]|1[0-2]|[1-9])[\/\-](0[1-9]|[12]\d|3[01]|[1-9])[\/\-](\d{4}|\d{2})/);
        
        if (textDateMatch) {
          const parsedDate = new Date(textDateMatch[0].replace(/(?:st|nd|rd|th)/i, ''));
          if (!isNaN(parsedDate.getTime())) {
            const m = String(parsedDate.getMonth() + 1).padStart(2, '0');
            const d = String(parsedDate.getDate()).padStart(2, '0');
            setExpenseDate(`${parsedDate.getFullYear()}-${m}-${d}`);
          }
        } else if (numericDateMatch) {
          const m = numericDateMatch[1].padStart(2, '0');
          const d = numericDateMatch[2].padStart(2, '0');
          let y = numericDateMatch[3];
          if (y.length === 2) {
             y = "20" + y;
          }
          setExpenseDate(`${y}-${m}-${d}`);
        }
        
        setNeedsVerification(true);

      } else {
        setScanStatus('Uploading to remote AI...');
        const formData = new FormData();
        formData.append('receipt', receipt);

        const res = await fetch('/api/ocr', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData
        });

        if (res.ok) {
          const data = await res.json();
          if (data.amount) setAmount(data.amount.toString());
          if (data.description) setDescription(data.description);
          if (data.date) setExpenseDate(data.date);
          setNeedsVerification(true);
        } else {
          const err = await res.json();
          alert(err.error || "Failed to scan receipt.");
        }
      }
    } catch (err: any) {
      alert(err.message || "Error scanning receipt.");
    } finally {
      setIsScanning(false);
      setScanProgress(0);
      setScanStatus('');
    }
  };

  // Creates a single-use, expiring invite code. The job key is never put in the invite: the owner approves each member
  // afterwards, which wraps the key for that member's public key (see MemberApproval).
  const copyJobId = async () => {
    try {
      const res = await fetch(`/api/jobs/${id}/invites`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create an invite');
      await navigator.clipboard.writeText(data.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err: any) {
      alert(err.message || 'Could not create an invite');
    }
  };

  const handleArchiveJob = async () => {
    if (!confirm(`Are you sure you want to ${job.is_archived ? 'unarchive' : 'archive'} this project?`)) return;
    const res = await fetch(`/api/jobs/${id}/archive`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ is_archived: !job.is_archived })
    });
    if (res.ok) setJob({ ...job, is_archived: !job.is_archived ? 1 : 0 });
  };

  const handleDeleteJob = async () => {
    if (!confirm('Are you sure you want to completely delete this project? All expenses and data associated with it will be permanently deleted. This action cannot be undone.')) return;
    const res = await fetch(`/api/jobs/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      navigate('/');
    } else {
      alert('Failed to delete job.');
    }
  };

  const handleLeaveJob = async () => {
    if (!confirm('Are you sure you want to leave this project? You will lose access to it.')) return;
    const res = await fetch(`/api/jobs/${id}/leave`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      navigate('/');
    } else {
      alert('Failed to leave job.');
    }
  };

  const fetchNextInvoiceNumberForTag = async (newTag: string, callback: (num: string) => void) => {
    try {
      const res = await fetch(`/api/jobs/next-invoice-number?tag=${encodeURIComponent(newTag)}&jobId=${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.invoiceNumber) {
          callback(data.invoiceNumber);
          return;
        }
      }
    } catch (e) {
      console.error('Failed to fetch next invoice number:', e);
    }
    const defaultPrefix = (invoiceTemplate?.default_prefix || 'INV').toUpperCase();
    const prefix = newTag ? newTag.toUpperCase() : defaultPrefix;
    callback(formatInvoiceNumber(prefix, 1));
  };

  const computeInvoiceNum = (seq: number | undefined, tag?: string | null) => {
    const cleanTag = tag ? tag.replace(/[^a-zA-Z0-9_-]/g, '').toUpperCase() : '';
    const defaultPrefix = (invoiceTemplate?.default_prefix || 'INV').toUpperCase();
    const prefix = cleanTag || defaultPrefix;
    return formatInvoiceNumber(prefix, seq || 1);
  };

  const openInvoiceModal = () => {
    setInvoiceTotalLaborHours('0');
    const defaultRate = (job.job_rate !== undefined && job.job_rate !== null && job.job_rate !== '')
      ? String(job.job_rate)
      : (invoiceTemplate?.default_hourly_rate !== undefined && invoiceTemplate?.default_hourly_rate !== null ? String(invoiceTemplate.default_hourly_rate) : '');
    setInvoiceHourlyRate(defaultRate);
    setInvoiceNotes(job.invoice_notes || '');
    setInvoiceTag(job.invoice_tag || '');
    setInvoiceNumber(job.invoice_number || computeInvoiceNum(job.invoice_seq, job.invoice_tag));
    setInvoiceModalError('');
    setInvoiceModalSuccess(false);
    setIsInvoiceModalOpen(true);
  };

  const handleInvoiceTagChange = (newTag: string) => {
    setInvoiceTag(newTag);
    setInvoiceModalError('');
    if (newTag === (job.invoice_tag || '')) {
      setInvoiceNumber(job.invoice_number || computeInvoiceNum(job.invoice_seq, job.invoice_tag));
    } else {
      fetchNextInvoiceNumberForTag(newTag, (num) => setInvoiceNumber(num));
    }
  };

  const handleSaveInvoiceDetails = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isSavingInvoice) return false;
    setIsSavingInvoice(true);
    setInvoiceModalError('');
    setInvoiceModalSuccess(false);
    try {
      const rateVal = parseFloat(invoiceHourlyRate) || 0;
      if (token && id && job.created_by === user?.id) {
        const res = await fetch(`/api/jobs/${id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            job_rate: rateVal,
            invoice_notes: invoiceNotes,
            invoice_tag: invoiceTag || null,
            invoice_number: invoiceNumber.trim() || null,
          }),
        });
        if (res.ok) {
          const updated = await res.json();
          setJob(updated);
          setInvoiceModalSuccess(true);
          setTimeout(() => setInvoiceModalSuccess(false), 3000);
          return true;
        } else {
          const err = await res.json();
          setInvoiceModalError(err.error || 'Failed to save invoice settings');
          return false;
        }
      }
      return true;
    } catch (err) {
      console.error("Failed to auto-save invoice settings to job:", err);
      setInvoiceModalError('Network error while saving invoice settings');
      return false;
    } finally {
      setIsSavingInvoice(false);
    }
  };

  const handleDownloadInvoice = async () => {
    const saved = await handleSaveInvoiceDetails();
    if (!saved) return;
    try {
      await invoiceRef.current?.generatePDF();
    } catch (err) {
      console.error("Failed to generate PDF:", err);
    }
  };

  const openEditJobModal = () => {
    setEditTitle(job.title);
    setEditDescription(job.description || '');
    setEditMode(job.mode || 'expense');
    setEditStartDate(job.start_date || '');
    setEditEndDate(job.end_date || '');
    setEditSyncExpenses(job.google_sync_expenses === 1);
    
    setEditClientName(job.client_name || '');
    setEditClientAddress(job.client_address || '');
    setEditClientEmail(job.client_email || '');
    setEditJobRate(job.job_rate?.toString() || '');
    setEditInvoiceNotes(job.invoice_notes || '');
    setEditInvoiceTag(job.invoice_tag || '');
    setEditInvoiceNumber(job.invoice_number || computeInvoiceNum(job.invoice_seq, job.invoice_tag));
    setEditJobError('');
    
    setIsEditJobModalOpen(true);
  };

  const handleEditTagChange = (newTag: string) => {
    setEditInvoiceTag(newTag);
    setEditJobError('');
    if (newTag === (job.invoice_tag || '')) {
      setEditInvoiceNumber(job.invoice_number || computeInvoiceNum(job.invoice_seq, job.invoice_tag));
    } else {
      fetchNextInvoiceNumberForTag(newTag, (num) => setEditInvoiceNumber(num));
    }
  };

  const handleEditJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEditingJob) return;
    setIsEditingJob(true);
    setEditJobError('');
    try {
      const res = await fetch(`/api/jobs/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: editTitle,
          description: editDescription,
          mode: editMode,
          start_date: editStartDate || null,
          end_date: editEndDate || null,
          google_sync_expenses: editSyncExpenses ? 1 : 0,
          client_name: editClientName,
          client_address: editClientAddress,
          client_email: editClientEmail,
          job_rate: parseFloat(editJobRate) || 0,
          invoice_notes: editInvoiceNotes,
          invoice_tag: editInvoiceTag || null,
          invoice_number: editInvoiceNumber.trim() || null,
        }),
      });
      if (res.ok) {
        const updatedJob = await res.json();
        if (updatedJob.sync_status) {
          console.log('[Google Calendar Sync - Job]:', updatedJob.sync_status);
        }
        setJob(updatedJob);
        setIsEditJobModalOpen(false);
      } else {
        const err = await res.json();
        setEditJobError(err.error || 'Failed to update job');
      }
    } catch (err) {
      console.error('Failed to update job', err);
      setEditJobError('Network error while updating job');
    } finally {
      setIsEditingJob(false);
    }
  };

  const handleEvictMember = async (userId: string) => {
    if (!confirm('Are you sure you want to remove this member from the job?')) return;
    const res = await fetch(`/api/jobs/${id}/members/${userId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setMembers(members.filter(m => m.id !== userId));
    } else {
      alert('Failed to remove member');
    }
  };

  const constructExpenseFormData = async (file: File | null, amt: string, desc: string, type: 'expense'|'income'): Promise<FormData | null> => {
    const formData = new FormData();
    formData.append('amount', amt);
    formData.append('description', desc);
    formData.append('entry_type', type);
    if (expenseDate) formData.append('date', expenseDate);
    
    // Map selected tag names back to their DB IDs
    const tagIds = selectedTags.map(name => globalTags.find(t => t.name === name)?.id).filter(Boolean);
    if (tagIds.length > 0) formData.append('tags', JSON.stringify(tagIds));
    
    const key = jobKey;
    if (file) {
      if (key) {
        try {
          const encryptedBlob = await encryptFile(file, key);
          formData.append('receipt', encryptedBlob, file.name);
          formData.append('is_encrypted', 'true');
        } catch (err) {
          console.error("Encryption failed", err);
          alert("Failed to encrypt receipt.");
          return null;
        }
      } else {
        formData.append('receipt', file);
        formData.append('is_encrypted', 'false');
      }
    }
    return formData;
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();

    // ── Offline path: queue locally ───────────────────────────────
    if (!isOnline) {
      const tempId = `pending_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const tagIds = selectedTags
        .map(name => globalTags.find(t => t.name === name)?.id)
        .filter(Boolean) as string[];

      const key = jobKey;
      let receiptBlob: Blob | null = null;
      let receiptName: string | null = null;
      let isEncrypted = false;

      if (receipt) {
        if (key) {
          try {
            receiptBlob = await encryptFile(receipt, key);
            receiptName = receipt.name;
            isEncrypted = true;
          } catch {
            alert('Could not encrypt receipt — it will be skipped for offline storage.');
          }
        } else {
          receiptBlob = receipt;
          receiptName = receipt.name;
        }
      }

      const pending: PendingExpense = {
        tempId,
        jobId: id!,
        amount,
        description,
        entryType,
        date: expenseDate || undefined,
        tagIds,
        receiptBlob,
        receiptName,
        isEncrypted,
        queuedAt: Date.now(),
      };

      await enqueuePendingExpense(pending);

      // Immediately show optimistically in the list
      const optimistic: Expense = {
        id: tempId,
        amount: parseFloat(amount),
        description,
        entry_type: entryType,
        receipt_url: null,
        is_encrypted: 0,
        user_id: user?.id ?? '',
        user_name: user?.username ?? 'You',
        created_at: new Date().toISOString(),
        date: expenseDate || undefined,
        tags: selectedTags
          .map(name => globalTags.find(t => t.name === name))
          .filter(Boolean) as Tag[],
        pendingSync: true,
      };

      setExpenses(prev => [optimistic, ...prev]);
      setPendingCount(prev => prev + 1);
      setIsModalOpen(false);
      setAmount(''); setDescription(''); setReceipt(null);
      setEntryType('expense'); setExpenseDate(''); setSelectedTags(job?.invoice_tag ? [job.invoice_tag] : []);
      return;
    }

    // ── Online path: send to server immediately ───────────────────
    setIsSubmitting(true);
    try {
      const formData = await constructExpenseFormData(receipt, amount, description, entryType);
      if (!formData) return;

      const res = await fetch(`/api/jobs/${id}/expenses`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (res.ok) {
        const result = await res.json();
        if (result.sync_status) {
          console.log('[Google Calendar Sync - Expense]:', result.sync_status);
        }

        if (isRecurring) {
          // Automatically derive billing day from the expense date, fallback to today
          const parsedDate = expenseDate ? new Date(expenseDate) : new Date();
          const derivedBillingDay = parsedDate.getDate();

          await fetch(`/api/jobs/${id}/subscriptions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              amount,
              description,
              entry_type: entryType,
              billing_day: derivedBillingDay,
              frequency: subscriptionFrequency,
              remind_1_day_before: remind1Day ? 1 : 0,
              remind_2_days_before: remind2Days ? 1 : 0,
              remind_7_days_before: remind7Days ? 1 : 0
            })
          });
          fetchSubscriptions();
        }

        setIsModalOpen(false);
        setAmount('');
        setDescription('');
        setReceipt(null);
        setEntryType('expense');
        setIsRecurring(false);
        setSubscriptionFrequency('MONTHLY');
        setRemind1Day(false);
        setRemind2Days(false);
        setRemind7Days(false);
        setSelectedTags(job?.invoice_tag ? [job.invoice_tag] : []);
      } else {
        await reportUploadError(res, 'Could not save the expense.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteExpense = async (expenseId: string) => {
    if (!isOnline) {
      alert('You are offline. Expense deletion is disabled until your connection is restored.');
      return;
    }
    if (!confirm('Are you sure you want to delete this entry?')) return;
    const res = await fetch(`/api/jobs/${id}/expenses/${expenseId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setExpenses(expenses.filter(e => e.id !== expenseId));
  };

  const handleAttachReceipt = async (e: React.ChangeEvent<HTMLInputElement>, expenseId: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_RECEIPT_BYTES) {
      alert(`"${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). The maximum receipt size is 15 MB.`);
      setAttachingToExId(null);
      e.target.value = '';
      return;
    }

    const key = jobKey;
    const formData = new FormData();
    if (key) {
      try {
        const encryptedBlob = await encryptFile(file, key);
        formData.append('receipt', encryptedBlob, file.name);
        formData.append('is_encrypted', 'true');
      } catch (err) {
        alert("Failed to encrypt receipt.");
        return;
      }
    } else {
      formData.append('receipt', file);
      formData.append('is_encrypted', 'false');
    }

    const res = await fetch(`/api/jobs/${id}/expenses/${expenseId}/receipt`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });

    if (res.ok) {
      const updated = await res.json();
      setExpenses(expenses.map(exp => exp.id === expenseId ? updated : exp));
    } else {
      await reportUploadError(res, 'Could not attach the receipt.');
    }
    setAttachingToExId(null);
    if (attachInputRef.current) attachInputRef.current.value = '';
  };

  const handleTerminateSubscription = async (subId: string) => {
    if (!confirm('Are you sure you want to terminate this subscription?')) return;
    const res = await fetch(`/api/jobs/${id}/subscriptions/${subId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setSubscriptions(subscriptions.filter(s => s.id !== subId));
    }
  };

  // Wishlist Actions
  const handleAddWishlist = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`/api/jobs/${id}/wishlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: wishName, estimated_cost: wishCost, url: wishUrl, notes: wishNotes })
    });

    if (res.ok) {
      const newItem = await res.json();
      setWishlistItems([newItem, ...wishlistItems]);
      setIsWishlistModalOpen(false);
      setWishName(''); setWishCost(''); setWishUrl(''); setWishNotes('');
    }
  };

  const handleDeleteWishlist = async (itemId: string) => {
    if (!confirm('Remove from wishlist?')) return;
    const res = await fetch(`/api/jobs/${id}/wishlist/${itemId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setWishlistItems(wishlistItems.filter(i => i.id !== itemId));
  };

  const handleConvertWishlist = async (itemId: string) => {
    const res = await fetch(`/api/jobs/${id}/wishlist/${itemId}/convert`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    
    if (res.ok) {
      const data = await res.json();
      setWishlistItems(wishlistItems.filter(i => i.id !== itemId));
      // Optimization: Event might arrive from socket, but we safely pre-add
      if (!expenses.find(e => e.id === data.expense.id)) {
        setExpenses([data.expense, ...expenses]);
      }
    }
  };

  const handleCreateInlineTag = async () => {
    if (!newTagName) return;
    const res = await fetch('/api/tags', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name: newTagName, color: newTagColor })
    });
    
    if (res.ok) {
      const tag = await res.json();
      setGlobalTags([tag, ...globalTags]);
      setSelectedTags([...selectedTags, tag.name]);
      setNewTagName('');
      setIsCreatingTag(false);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await fetch(`/api/jobs/${id}/export`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to export');
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      const contentDisposition = res.headers.get('content-disposition');
      let filename = 'glassexpense_export.json';
      if (contentDisposition && contentDisposition.includes('filename=')) {
        filename = contentDisposition.split('filename=')[1].split(';')[0].replace(/"/g, '');
      }
      
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      alert('Error exporting job.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.expenses || !Array.isArray(data.expenses)) {
        throw new Error('Invalid JSON format. Requires an "expenses" array.');
      }

      const res = await fetch(`/api/jobs/${id}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ expenses: data.expenses })
      });
      
      if (!res.ok) throw new Error('Failed to import');
    } catch (err: any) {
      alert(`Import failed: ${err.message}`);
    } finally {
      setIsImporting(false);
      if (jsonImportRef.current) jsonImportRef.current.value = '';
    }
  };

  // AI Notes Logic
  const handleSaveNotes = async () => {
    setIsSavingNotes(true);
    const updatedDescription = `${baseDescription}\n\n### 🤖 AI Research\n${editedNotes.replace(/^### (?:🤖 )?AI Research\n?/i, '')}`;
    try {
      const res = await fetch(`/api/jobs/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          title: job.title,
          description: updatedDescription,
          is_budget: job.mode === 'budget' ? 1 : 0,
          start_date: job.start_date,
          end_date: job.end_date,
          sync_expenses_to_calendar: job.sync_expenses_to_calendar
        })
      });
      if (res.ok) {
        const updatedJob = await res.json();
        setJob(updatedJob);
        setIsEditingNotes(false);
      }
    } catch (error) {
      console.error("Failed to save notes", error);
    } finally {
      setIsSavingNotes(false);
    }
  };

  const closeExpenseModal = () => {
    setIsModalOpen(false);
    setAmount('');
    setDescription('');
    setReceipt(null);
    setEntryType('expense');
    setExpenseDate('');
    setSelectedTags(job?.invoice_tag ? [job.invoice_tag] : []);
    setNeedsVerification(false);
    setIsCreatingTag(false);
    setNewTagName('');
    setIsRecurring(false);
    setSubscriptionFrequency('MONTHLY');
  };

  if (!job) return <div className="text-center py-20 text-gray-400">Loading details...</div>;

  const isBudget = job.mode === 'budget';
  const totalIncome = expenses.filter(e => e.entry_type === 'income').reduce((sum, e) => sum + e.amount, 0);
  const totalExpense = expenses.filter(e => e.entry_type === 'expense').reduce((sum, e) => sum + e.amount, 0);
  const netBalance = totalIncome - totalExpense;

  const processedExpenses = expenses
    .filter(e => {
      if (filterTags.length === 0) return true;
      if (!e.tags) return false;
      return filterTags.every(ft => e.tags!.some(t => t.name === ft));
    })
    .sort((a, b) => {
      if (sortBy === 'amount_desc') return b.amount - a.amount;
      if (sortBy === 'amount_asc') return a.amount - b.amount;
      
      const aDate = new Date(a.date || a.created_at).getTime();
      const bDate = new Date(b.date || b.created_at).getTime();
      
      if (sortBy === 'date_asc') return aDate - bDate;
      return bDate - aDate; // default date_desc
    });

  // Extract AI Notes
  const jobDescriptionFull = job.description || '';
  const aiNoteSplitIndex = jobDescriptionFull.indexOf('###');
  
  let baseDescription = jobDescriptionFull;
  let aiNotes = '';

  if (aiNoteSplitIndex !== -1) {
    baseDescription = jobDescriptionFull.substring(0, aiNoteSplitIndex).trim();
    aiNotes = jobDescriptionFull.substring(aiNoteSplitIndex).trim();
  }

  return (
    <div className="space-y-8">

      {/* ── Offline / Syncing Banner ──────────────────────────── */}
      <AnimatePresence>
        {(!isOnline || isSyncing) && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className={`flex items-center gap-3 px-5 py-3 rounded-2xl border text-sm font-medium ${
              isSyncing
                ? 'bg-[#7c3bed]/10 border-[#7c3bed]/30 text-[#a78bfa]'
                : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
            }`}
          >
            {isSyncing ? (
              <>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                >
                  <CloudUpload className="w-4 h-4" />
                </motion.div>
                <span>Syncing {pendingCount} offline expense{pendingCount !== 1 ? 's' : ''} to server…</span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4" />
                <span>
                  You are <strong>offline</strong>. You can still view and add expenses — they will sync automatically when you reconnect.
                  {pendingCount > 0 && ` (${pendingCount} pending)`}
                </span>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              {job.title}
              {isEditingJob ? (
                <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" title="Syncing..." />
              ) : job.google_event_id ? (
                <Calendar className="w-5 h-5 text-emerald-400" title="Synced to Google Calendar" />
              ) : (
                <Calendar className="w-5 h-5 text-blue-400 opacity-50" title="Not synced to Google Calendar (Missing dates?)" />
              )}
            </h1>
            {job.invoice_number && (
              <span className="px-2.5 py-1 bg-indigo-500/10 text-indigo-400 text-xs font-mono font-semibold uppercase tracking-wider rounded-lg border border-indigo-500/20" title="Invoice Number">
                {job.invoice_number}
              </span>
            )}
            {job.invoice_tag && (
              <span className="px-2.5 py-1 bg-purple-500/10 text-purple-300 text-xs font-semibold uppercase tracking-wider rounded-lg border border-purple-500/20 flex items-center gap-1.5" title={`Job Category / Tag: ${job.invoice_tag}`}>
                <TagIcon className="w-3.5 h-3.5 text-purple-400" />
                {job.invoice_tag}
              </span>
            )}
            {job.client_name && (
              <span className="px-2.5 py-1 bg-white/5 text-gray-300 text-xs font-medium rounded-lg border border-white/10" title="Client">
                Client: {job.client_name}
              </span>
            )}
            {isBudget && (
              <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 text-xs font-bold uppercase tracking-wider rounded-lg border border-emerald-500/20">
                Budget Mode
              </span>
            )}
          </div>
          <p className="text-gray-400 max-w-2xl whitespace-pre-wrap">{baseDescription}</p>
          {aiNotes && (
            <div 
              onClick={() => {
                setEditedNotes(aiNotes);
                setIsNotesModalOpen(true);
              }}
              className="mt-4 flex items-start gap-3 bg-indigo-500/10 border border-indigo-500/20 hover:bg-indigo-500/20 transition-colors p-4 rounded-xl cursor-pointer max-w-2xl group"
            >
              <div className="bg-indigo-500/20 p-2 rounded-lg mt-0.5">
                <Bot className="w-5 h-5 text-indigo-400" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <h4 className="text-sm font-semibold text-indigo-300 flex items-center gap-2">
                    AI Research Notes
                    <span className="text-[10px] uppercase tracking-wider bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded">Hermes</span>
                  </h4>
                  <Maximize2 className="w-4 h-4 text-indigo-400/50 group-hover:text-indigo-400 transition-colors" />
                </div>
                <p className="text-xs text-indigo-200/70 line-clamp-2">
                  {aiNotes.replace(/#/g, '').substring(0, 150)}...
                </p>
              </div>
            </div>
          )}
        </div>
        
        {/* Action Buttons Cluster */}
        <div className="w-full sm:w-[420px] md:w-[440px] lg:w-[450px] flex flex-col gap-2 shrink-0 self-start md:self-center">
          {/* Utilities Mini Bar (Top Right) */}
          <div className="flex items-center justify-end gap-1.5 pb-0.5">
            <button
              onClick={() => setIsSubModalOpen(true)}
              className="flex items-center justify-center p-2 rounded-xl bg-[#1c172d]/80 hover:bg-[#1c172d] border border-white/10 text-[#7c3bed] hover:text-white transition-colors"
              title="Manage Subscriptions"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="flex items-center justify-center p-2 rounded-xl bg-[#1c172d]/80 hover:bg-[#1c172d] border border-white/10 text-emerald-400 hover:text-white transition-colors disabled:opacity-50"
              title="Export Job to JSON"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => jsonImportRef.current?.click()}
              disabled={isImporting}
              className="flex items-center justify-center p-2 rounded-xl bg-[#1c172d]/80 hover:bg-[#1c172d] border border-white/10 text-blue-400 hover:text-white transition-colors disabled:opacity-50"
              title="Import Data from JSON"
            >
              <Upload className="w-3.5 h-3.5" />
            </button>
          </div>

          {job.created_by === user?.id ? (
            <>
              {/* Row 1: 3 Equal Buttons */}
              <div className="grid grid-cols-3 gap-2 w-full">
                <button
                  onClick={openInvoiceModal}
                  className="flex items-center justify-center space-x-1.5 bg-indigo-500 hover:bg-indigo-600 border border-indigo-400/50 py-2.5 px-2 rounded-xl text-xs sm:text-sm font-medium text-white transition-colors shadow-sm"
                >
                  <FileText className="w-4 h-4 shrink-0" />
                  <span className="truncate">Invoice</span>
                </button>
                <button
                  onClick={openEditJobModal}
                  className="flex items-center justify-center space-x-1.5 bg-[#1c172d]/80 hover:bg-[#1c172d] border border-white/10 py-2.5 px-2 rounded-xl text-xs sm:text-sm font-medium text-gray-300 hover:text-white transition-colors"
                >
                  <Sparkles className="w-4 h-4 shrink-0" />
                  <span className="truncate">Edit</span>
                </button>
                <button
                  onClick={handleArchiveJob}
                  className="flex items-center justify-center space-x-1.5 bg-[#1c172d]/80 hover:bg-[#1c172d] border border-white/10 py-2.5 px-2 rounded-xl text-xs sm:text-sm font-medium text-gray-300 hover:text-white transition-colors"
                >
                  <Archive className="w-4 h-4 shrink-0" />
                  <span className="truncate">{job.is_archived ? 'Unarchive' : 'Archive'}</span>
                </button>
              </div>

              {/* Row 2: 3 Equal Buttons */}
              <div className="grid grid-cols-3 gap-2 w-full">
                <button
                  onClick={handleDeleteJob}
                  className="flex items-center justify-center space-x-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 py-2.5 px-2 rounded-xl text-xs sm:text-sm font-medium text-red-400 hover:text-red-300 transition-colors"
                  title="Permanently Delete Job"
                >
                  <Trash2 className="w-4 h-4 shrink-0" />
                  <span className="truncate">Delete</span>
                </button>
                <button
                  onClick={copyJobId}
                  className="flex items-center justify-center space-x-1.5 bg-[#1c172d]/80 hover:bg-[#1c172d] border border-white/10 py-2.5 px-2 rounded-xl text-xs sm:text-sm font-medium text-gray-300 hover:text-white transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400 shrink-0" /> : <Copy className="w-4 h-4 text-gray-400 shrink-0" />}
                  <span className="truncate">{copied ? 'Invite copied' : 'Copy invite'}</span>
                </button>
                <button
                  onClick={() => setIsMembersModalOpen(true)}
                  className="flex items-center justify-center space-x-1.5 bg-[#1c172d]/80 hover:bg-[#1c172d] border border-white/10 py-2.5 px-2 rounded-xl text-xs sm:text-sm font-medium text-gray-300 hover:text-white transition-colors"
                >
                  <ListTree className="w-4 h-4 shrink-0" />
                  <span className="truncate">Members ({members.length + 1})</span>
                </button>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-3 gap-2 w-full">
              <button
                onClick={handleLeaveJob}
                className="flex items-center justify-center space-x-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 py-2.5 px-2 rounded-xl text-xs sm:text-sm font-medium text-amber-400 hover:text-amber-300 transition-colors"
                title="Leave Job"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                <span className="truncate">Leave</span>
              </button>
              <button
                onClick={copyJobId}
                className="flex items-center justify-center space-x-1.5 bg-[#1c172d]/80 hover:bg-[#1c172d] border border-white/10 py-2.5 px-2 rounded-xl text-xs sm:text-sm font-medium text-gray-300 hover:text-white transition-colors"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-400 shrink-0" /> : <Copy className="w-4 h-4 text-gray-400 shrink-0" />}
                <span className="truncate">{copied ? 'Invite copied' : 'Copy invite'}</span>
              </button>
              <button
                onClick={() => setIsMembersModalOpen(true)}
                className="flex items-center justify-center space-x-1.5 bg-[#1c172d]/80 hover:bg-[#1c172d] border border-white/10 py-2.5 px-2 rounded-xl text-xs sm:text-sm font-medium text-gray-300 hover:text-white transition-colors"
              >
                <ListTree className="w-4 h-4 shrink-0" />
                <span className="truncate">Members ({members.length + 1})</span>
              </button>
            </div>
          )}

          {/* Row 3: Sole Primary Action Button Scaling Full Width */}
          {activeTab === 'entries' ? (
            <button
              onClick={() => {
                if (job?.invoice_tag && !selectedTags.includes(job.invoice_tag)) {
                  setSelectedTags([job.invoice_tag]);
                }
                setIsModalOpen(true);
              }}
              className="w-full bg-[#7c3bed] hover:bg-[#6b33cc] text-white py-2.5 px-4 rounded-xl font-medium flex items-center justify-center space-x-2 shadow-lg shadow-[#7c3bed]/25 transition-all text-sm"
            >
              <Plus className="w-5 h-5 shrink-0" />
              <span>{isBudget ? 'Add Entry' : 'Add Expense'}</span>
            </button>
          ) : (
            <button
              onClick={() => setIsWishlistModalOpen(true)}
              className="w-full bg-[#7c3bed] hover:bg-[#6b33cc] text-white py-2.5 px-4 rounded-xl font-medium flex items-center justify-center space-x-2 shadow-lg shadow-[#7c3bed]/25 transition-all text-sm"
            >
              <Plus className="w-5 h-5 shrink-0" />
              <span>Add Wishlist Item</span>
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="bg-[#1c172d]/60 border border-white/5 rounded-3xl p-8 sticky top-24">
            <div className={`w-14 h-14 bg-emerald-500/10 rounded-2xl flex items-center justify-center mb-6`}>
              <DollarSign className="w-8 h-8 text-emerald-400" />
            </div>
            
            <h3 className="text-gray-400 font-medium mb-2">
              {isBudget ? 'Net Balance' : 'Total Expenses'}
            </h3>
            
            <div className={`text-5xl font-bold tracking-tighter ${isBudget && netBalance < 0 ? 'text-rose-400' : 'text-white'}`}>
              {isBudget ? (netBalance < 0 ? `-$${Math.abs(netBalance).toFixed(2)}` : `$${netBalance.toFixed(2)}`) : `$${totalExpense.toFixed(2)}`}
            </div>

            {isBudget && (
              <div className="mt-8 space-y-3">
                <div className="flex justify-between items-center p-3 rounded-xl bg-white/5 border border-white/5">
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div> Total Income
                  </div>
                  <span className="font-medium text-emerald-400">+${totalIncome.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center p-3 rounded-xl bg-white/5 border border-white/5">
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <div className="w-2 h-2 rounded-full bg-rose-500"></div> Total Costs
                  </div>
                  <span className="font-medium text-rose-400">-${totalExpense.toFixed(2)}</span>
                </div>
              </div>
            )}

            <div className="mt-8 pt-8 border-t border-white/5">
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-400">Total Entries</span>
                <span className="font-medium text-white">{expenses.length}</span>
              </div>
            </div>
          </div>
          
          {isBudget && expenses.length > 0 && (
            <BudgetTrendChart expenses={expenses} />
          )}
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center border-b border-white/10">
            <button
              onClick={() => setActiveTab('entries')}
              className={`pb-3 px-4 text-sm font-medium transition-colors border-b-2 ${activeTab === 'entries' ? 'border-[#7c3bed] text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
            >
              <div className="flex items-center gap-2">
                <Receipt className="w-4 h-4" />
                {isBudget ? 'Entries' : 'Expenses'}
              </div>
            </button>
            <button
              onClick={() => setActiveTab('wishlist')}
              className={`pb-3 px-4 text-sm font-medium transition-colors border-b-2 flex items-center gap-2 ${activeTab === 'wishlist' ? 'border-[#7c3bed] text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
            >
              <ListTree className="w-4 h-4" />
              Wishlist <span className="bg-white/10 text-xs px-2 py-0.5 rounded-full">{wishlistItems.length}</span>
            </button>
          </div>

          <AnimatePresence mode="wait">
            {activeTab === 'entries' ? (
              <motion.div key="entries" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                {expenses.length > 0 && (
                  <div className="bg-[#1c172d]/40 border border-white/5 rounded-2xl p-4 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between mb-6">
                    <div className="flex flex-col gap-2 w-full md:w-auto">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Sort By</span>
                      <select 
                        value={sortBy} 
                        onChange={(e) => setSortBy(e.target.value as any)}
                        className="bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-[#7c3bed]/50 transition-colors"
                      >
                        <option value="date_desc" className="bg-[#1c172d]">Date (Newest First)</option>
                        <option value="date_asc" className="bg-[#1c172d]">Date (Oldest First)</option>
                        <option value="amount_desc" className="bg-[#1c172d]">Amount (Highest First)</option>
                        <option value="amount_asc" className="bg-[#1c172d]">Amount (Lowest First)</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-2 w-full md:w-auto">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Filter by My Tags</span>
                      <div className="flex flex-wrap gap-2">
                        {globalTags.map(tag => {
                          const isSelected = filterTags.includes(tag.name);
                          return (
                            <button
                              key={tag.id}
                              onClick={() => {
                                if (isSelected) setFilterTags(filterTags.filter(t => t !== tag.name));
                                else setFilterTags([...filterTags, tag.name]);
                              }}
                              style={{ borderColor: isSelected ? tag.color : undefined }}
                              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors flex items-center gap-1.5 ${isSelected ? 'bg-white/10 text-white' : 'border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/20'}`}
                            >
                              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
                              {tag.name}
                            </button>
                          );
                        })}
                        {globalTags.length === 0 && <span className="text-xs text-gray-500 italic py-1">No tags to filter.</span>}
                      </div>
                    </div>
                  </div>
                )}

                {processedExpenses.length === 0 ? (
                  <div className="bg-[#1c172d]/30 border border-white/5 rounded-2xl p-10 text-center">
                    <p className="text-gray-400">{expenses.length > 0 ? "No entries match your filters." : "No entries recorded yet."}</p>
                  </div>
                ) : (
                  processedExpenses.map((expense) => (
                    <div
                      key={expense.id}
                      className={`bg-[#1c172d]/40 hover:bg-[#1c172d]/60 border rounded-2xl p-5 flex items-start gap-5 transition-colors ${
                        expense.pendingSync
                          ? 'border-amber-500/30 bg-amber-500/5'
                          : 'border-white/5'
                      }`}
                    >
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center flex-shrink-0 border border-white/5">
                        <span className="text-lg font-bold text-gray-300">
                          {expense.user_name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start mb-1">
                          <h4 className="font-medium text-white truncate pr-4 flex items-center gap-2">
                            {expense.description || 'Untitled Entry'}
                            {isBudget && (
                              <span className={`text-[10px] px-2 py-0.5 rounded uppercase tracking-wider font-bold ${expense.entry_type === 'income' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                                {expense.entry_type}
                              </span>
                            )}
                            {expense.google_event_id ? (
                              <Calendar className="w-3 h-3 text-emerald-400" title="Synced to Google Calendar" />
                            ) : (
                              <Calendar className="w-3 h-3 text-blue-400 opacity-50" title="Not synced to Google Calendar (Missing date?)" />
                            )}
                            {expense.pendingSync && (
                              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 font-bold uppercase tracking-wider">
                                <CloudUpload className="w-2.5 h-2.5" />
                                Pending Sync
                              </span>
                            )}
                          </h4>
                          <div className="flex items-center gap-3">
                            <span className={`font-bold whitespace-nowrap ${isBudget && expense.entry_type === 'income' ? 'text-emerald-400' : isBudget && expense.entry_type === 'expense' ? 'text-rose-400' : 'text-emerald-400'}`}>
                              {isBudget && expense.entry_type === 'income' ? '+' : isBudget ? '-' : ''}${expense.amount.toFixed(2)}
                            </span>
                            {(expense.user_id === user?.id || job.created_by === user?.id) && (
                              <button
                                onClick={() => handleDeleteExpense(expense.id)}
                                disabled={!!expense.pendingSync}
                                className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
                                title={expense.pendingSync ? 'Cannot delete — pending sync' : 'Delete entry'}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-3 text-sm text-gray-400 mb-3">
                          <span>By {expense.user_name}</span>
                          <span>•</span>
                          <span>
                            {expense.date 
                              ? new Date(expense.date).toLocaleDateString(undefined, { timeZone: 'UTC' }) 
                              : new Date(expense.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          {expense.receipt_url ? (
                            <>
                              <ViewReceiptButton url={expense.receipt_url} isEncrypted={expense.is_encrypted} jobId={job.id} jobKey={jobKey} />
                              <button 
                                onClick={() => { setAttachingToExId(expense.id); attachInputRef.current?.click(); }}
                                className="p-1.5 text-gray-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                                title="Replace Receipt"
                              >
                                <RefreshCw className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <button 
                              onClick={() => { setAttachingToExId(expense.id); attachInputRef.current?.click(); }}
                              className="inline-flex items-center gap-2 text-xs font-medium text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg transition-colors"
                            >
                              <Paperclip className="w-3.5 h-3.5" /> Attach Receipt
                            </button>
                          )}
                          
                          {expense.tags && expense.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 ml-auto">
                              {expense.tags.map(t => (
                                <span key={t.id} className="text-[10px] px-2 py-0.5 rounded-full border bg-black/40 text-gray-300" style={{ borderColor: t.color }}>
                                  {t.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </motion.div>
            ) : (
              <motion.div key="wishlist" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
                {wishlistItems.length === 0 ? (
                  <div className="bg-[#1c172d]/30 border border-white/5 rounded-2xl p-10 text-center">
                    <p className="text-gray-400">No wishlist items planned yet.</p>
                  </div>
                ) : (
                  wishlistItems.map((item) => (
                    <div key={item.id} className="bg-[#1c172d]/40 border border-white/5 rounded-2xl p-5 flex items-start justify-between gap-5 group">
                      <div className="min-w-0">
                        <h4 className="font-medium text-white mb-1 flex items-center gap-3">
                          {item.name}
                          {item.estimated_cost && <span className="text-emerald-400 text-sm font-bold bg-emerald-400/10 px-2 py-0.5 rounded">~${item.estimated_cost.toFixed(2)}</span>}
                        </h4>
                        <div className="text-sm text-gray-400 mb-3 space-y-1">
                          {item.notes && <p className="line-clamp-2">{item.notes}</p>}
                          <div className="flex gap-3 text-xs">
                            <span>Added by {item.user_name}</span>
                          </div>
                        </div>
                        {item.url && (
                          <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-[#7c3bed] bg-[#7c3bed]/10 px-3 py-1.5 rounded-lg hover:bg-[#7c3bed]/20 transition-colors">
                            <LinkIcon className="w-3.5 h-3.5" /> Store Link
                          </a>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {(item.user_id === user?.id || job.created_by === user?.id) && (
                          <button onClick={() => handleDeleteWishlist(item.id)} className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                        <button 
                          onClick={() => handleConvertWishlist(item.id)} 
                          className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 p-2 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium"
                          title="Convert to Entry"
                        >
                          <Check className="w-4 h-4" /> <span className="hidden sm:inline">Convert</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Hidden file input for attaching to existing expense */}
      <input type="file" ref={fileInputRef} onChange={handleReceiptFileChosen} className="hidden" accept="image/*,application/pdf" />
      <input type="file" ref={attachInputRef}onChange={(e) => attachingToExId && handleAttachReceipt(e, attachingToExId)} className="hidden" accept="image/*" />
      <input type="file" ref={jsonImportRef} onChange={handleImport} className="hidden" accept="application/json,.json" />

      {/* Expense Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className={`bg-[#1c172d] border border-white/10 rounded-3xl overflow-hidden w-full ${receiptPreviewUrl ? 'max-w-4xl' : 'max-w-md'} shadow-2xl relative flex flex-col md:flex-row my-auto`}>
            {receiptPreviewUrl && (
              <div className="md:w-1/2 bg-black/40 border-r border-white/5 p-6 flex flex-col">
                <h3 className="text-sm font-medium text-gray-400 mb-4 tracking-wider uppercase">Receipt Image</h3>
                <div className="flex-1 min-h-[300px] relative rounded-xl overflow-hidden border border-white/10 bg-black/20 flex items-center justify-center p-2">
                  <img src={receiptPreviewUrl} alt="Receipt preview" className="max-w-full max-h-full object-contain" />
                </div>
              </div>
            )}

            <div className={`p-8 ${receiptPreviewUrl ? 'md:w-1/2' : 'w-full'}`}>
              <button 
                onClick={closeExpenseModal}
                className="absolute top-6 right-6 text-gray-500 hover:text-white transition-colors"
                title="Close"
              >
                <Plus className="w-6 h-6 rotate-45" />
              </button>
              
              <h2 className="text-2xl font-bold mb-6">{isBudget ? 'Record Entry' : 'Record Expense'}</h2>
              
              {needsVerification && (
                <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-3">
                  <Sparkles className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="text-sm font-medium text-amber-500 mb-1">Verify Extracted Data</h4>
                    <p className="text-xs text-amber-500/80">AI has extracted data from your receipt. Please review and ensure all fields are correct before saving.</p>
                  </div>
                </div>
              )}

              <form onSubmit={handleAddExpense} className="space-y-5">
                {isBudget && (
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Entry Type</label>
                    <div className="flex bg-black/20 p-1 rounded-xl border border-white/10">
                      <button type="button" onClick={() => setEntryType('expense')} className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${entryType === 'expense' ? 'bg-rose-500/20 text-rose-400 shadow-md border border-rose-500/30' : 'text-gray-500 hover:text-gray-300'}`}>Expense</button>
                      <button type="button" onClick={() => setEntryType('income')} className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${entryType === 'income' ? 'bg-emerald-500/20 text-emerald-400 shadow-md border border-emerald-500/30' : 'text-gray-500 hover:text-gray-300'}`}>Income</button>
                    </div>
                  </div>
                )}
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Amount ($)</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <DollarSign className="h-5 w-5 text-gray-500" />
                      </div>
                      <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full bg-black/20 border border-white/10 rounded-xl pl-11 pr-4 py-3 text-white placeholder-gray-500 focus:ring-2 focus:ring-[#7c3bed]/50" placeholder="0.00" required />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Date (Optional)</label>
                    <input type="date" value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:ring-2 focus:ring-[#7c3bed]/50" />
                  </div>
                </div>

                <div className="p-4 bg-black/20 border border-white/5 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm font-medium text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isRecurring}
                        onChange={(e) => setIsRecurring(e.target.checked)}
                        disabled={!isOnline}
                        className="rounded border-gray-600 text-[#7c3bed] focus:ring-[#7c3bed] bg-black/20"
                      />
                      Make this a recurring subscription
                    </label>
                    {!isOnline && <span className="text-xs text-amber-500">Requires connection</span>}
                  </div>
                  
                  {isRecurring && (
                    <div className="space-y-4 pt-2">
                      <div className="flex gap-4">
                        <div className="flex-1">
                          <label className="block text-xs font-medium text-gray-400 mb-1">Frequency</label>
                          <select
                            value={subscriptionFrequency}
                            onChange={(e) => setSubscriptionFrequency(e.target.value)}
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#7c3bed]"
                          >
                            <option value="MONTHLY">Monthly</option>
                            <option value="QUARTERLY">Quarterly (3 months)</option>
                            <option value="SEMIANNUAL">Semi-annually (6 months)</option>
                            <option value="YEARLY">Annually</option>
                          </select>
                        </div>
                      </div>

                      <div className="border-t border-white/5 pt-3">
                        <label className="block text-xs font-medium text-gray-400 mb-2">Configure Reminders</label>
                        <div className="flex flex-col gap-2">
                          <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={remind1Day}
                              onChange={(e) => setRemind1Day(e.target.checked)}
                              className="rounded border-gray-600 text-[#7c3bed] focus:ring-[#7c3bed] bg-black/20"
                            />
                            1 day before
                          </label>
                          <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={remind2Days}
                              onChange={(e) => setRemind2Days(e.target.checked)}
                              className="rounded border-gray-600 text-[#7c3bed] focus:ring-[#7c3bed] bg-black/20"
                            />
                            2 days before
                          </label>
                          <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={remind7Days}
                              onChange={(e) => setRemind7Days(e.target.checked)}
                              className="rounded border-gray-600 text-[#7c3bed] focus:ring-[#7c3bed] bg-black/20"
                            />
                            1 week before
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-300">Description</label>
                    <button
                      type="button"
                      onClick={handleAiScan}
                      disabled={isScanning}
                      className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded transition-all ${
                        user?.plan === 'free' && !user?.isAdmin
                          ? 'bg-gray-500/20 text-gray-400 cursor-not-allowed hover:bg-gray-500/30'
                          : !aiConfigured 
                            ? 'bg-[#7c3bed]/10 text-[#7c3bed] hover:bg-[#7c3bed]/20 shadow-lg shadow-[#7c3bed]/5' 
                            : 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 active:scale-95'
                      }`}
                      title={user?.plan === 'free' && !user?.isAdmin ? "Upgrade to Paid Tier to unlock AI Scanning" : !aiConfigured ? "Setup AI API Key in Settings to scan" : "AI Receipt Scanning with connected OCR"}
                    >
                      <Sparkles className={`w-3 h-3 ${isScanning ? 'animate-spin' : ''}`} />
                      {isScanning ? (scanStatus || 'Scanning...') : (user?.plan === 'free' && !user?.isAdmin ? 'Unlock AI' : 'Magic Scan')}
                    </button>
                  </div>
                  <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:ring-2 focus:ring-[#7c3bed]/50" placeholder="What was this for?" required />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-gray-300">My Tags</label>
                    <button
                      type="button"
                      onClick={() => setIsCreatingTag(!isCreatingTag)}
                      className="text-xs text-[#7c3bed] hover:text-white transition-colors flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> Create Tag
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2 mb-2">
                    {globalTags.map(tag => {
                      const isSelected = selectedTags.includes(tag.name);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => {
                            if (isSelected) setSelectedTags(selectedTags.filter(t => t !== tag.name));
                            else setSelectedTags([...selectedTags, tag.name]);
                          }}
                          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-2 ${isSelected ? 'bg-white/10 text-white' : 'border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/20'}`}
                          style={{ borderColor: isSelected ? tag.color : undefined }}
                        >
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tag.color }} />
                          {tag.name}
                        </button>
                      );
                    })}
                    {globalTags.length === 0 && !isCreatingTag && <span className="text-gray-500 text-sm">No tags available. Click "Create Tag" to add one.</span>}
                  </div>

                  <AnimatePresence>
                    {isCreatingTag && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-3 bg-black/20 p-2 rounded-xl border border-white/5 flex items-center gap-2 overflow-hidden">
                        <input
                          type="color"
                          value={newTagColor}
                          onChange={(e) => setNewTagColor(e.target.value)}
                          className="w-8 h-8 rounded shrink-0 cursor-pointer bg-transparent border-0 p-0"
                        />
                        <input
                          type="text"
                          value={newTagName}
                          onChange={(e) => setNewTagName(e.target.value)}
                          onKeyDown={(e) => { e.key === 'Enter' && (e.preventDefault(), handleCreateInlineTag()); }}
                          className="flex-1 bg-transparent border-none text-sm text-white focus:ring-0 focus:outline-none px-2"
                          placeholder="New tag name..."
                        />
                        <button type="button" onClick={handleCreateInlineTag} disabled={!newTagName} className="px-3 py-1.5 bg-[#7c3bed] hover:bg-[#6b33cc] text-white text-xs font-medium rounded-lg disabled:opacity-50 transition-colors">
                          Add
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Receipt Image (Optional)</label>
                  <div onClick={handleCameraClick} className="w-full border-2 border-dashed border-white/10 hover:border-[#7c3bed]/50 rounded-xl p-6 text-center cursor-pointer transition-colors bg-black/10">
                    {receipt ? (
                      <div className="flex items-center justify-center gap-2 text-emerald-400">
                        <Check className="w-5 h-5" /> <span className="text-sm font-medium truncate max-w-[200px]">{receipt.name}</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-gray-400">
                        <ImageIcon className="w-6 h-6" /> <span className="text-sm">Tap to capture or select receipt</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end space-x-3 mt-8">
                  <button type="button" onClick={closeExpenseModal} disabled={isSubmitting} className="px-5 py-2.5 rounded-xl font-medium text-gray-300 hover:bg-white/5 transition-colors disabled:opacity-50">Cancel</button>
                  <button type="submit" disabled={isSubmitting} className="bg-[#7c3bed] hover:bg-[#6b33cc] text-white px-5 py-2.5 rounded-xl font-medium transition-colors shadow-lg shadow-[#7c3bed]/20 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed">
                    {isSubmitting && <RefreshCw className="w-4 h-4 animate-spin" />}
                    {isSubmitting ? 'Saving...' : `Save ${isBudget ? 'Entry' : 'Expense'}`}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        </div>
      )}

      {/* Wishlist Modal */}
      {isWishlistModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-[#1c172d] border border-white/10 rounded-3xl p-8 w-full max-w-md shadow-2xl">
            <h2 className="text-2xl font-bold mb-6">Add to Wishlist</h2>
            <form onSubmit={handleAddWishlist} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Item Name</label>
                <input type="text" value={wishName} onChange={(e) => setWishName(e.target.value)} className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-[#7c3bed]/50" required placeholder="e.g. New Monitor" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Estimated Cost (Optional)</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none"><DollarSign className="h-5 w-5 text-gray-500" /></div>
                  <input type="number" step="0.01" min="0" value={wishCost} onChange={(e) => setWishCost(e.target.value)} className="w-full bg-black/20 border border-white/10 rounded-xl pl-11 pr-4 py-3 text-white focus:ring-2 focus:ring-[#7c3bed]/50" placeholder="0.00" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Link (Optional)</label>
                <input type="url" value={wishUrl} onChange={(e) => setWishUrl(e.target.value)} className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-[#7c3bed]/50" placeholder="https://store.com/item" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Notes (Optional)</label>
                <textarea value={wishNotes} onChange={(e) => setWishNotes(e.target.value)} className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-[#7c3bed]/50 resize-none h-20" placeholder="Size, color, etc." />
              </div>
              <div className="flex justify-end space-x-3 mt-6">
                <button type="button" onClick={() => setIsWishlistModalOpen(false)} className="px-5 py-2.5 rounded-xl font-medium text-gray-300 hover:bg-white/5">Cancel</button>
                <button type="submit" className="bg-[#7c3bed] hover:bg-[#6b33cc] text-white px-5 py-2.5 rounded-xl font-medium shadow-lg">Save Item</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Edit Job Modal */}
      {isEditJobModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }} 
            animate={{ opacity: 1, scale: 1 }} 
            className="bg-[#1c172d] border border-white/10 rounded-3xl w-full max-w-5xl shadow-2xl max-h-[calc(100dvh-2rem)] sm:max-h-[90vh] flex flex-col overflow-hidden my-auto"
          >
            {/* Header (Fixed) */}
            <div className="flex justify-between items-center p-6 sm:p-7 pb-4 border-b border-white/10 shrink-0">
              <div>
                <h2 className="text-2xl font-bold flex items-center gap-2 text-white">
                  <Briefcase className="w-6 h-6 text-[#7c3bed]" /> Edit Job
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">Update project settings and client invoicing defaults</p>
              </div>
              <button 
                onClick={() => setIsEditJobModalOpen(false)} 
                className="w-9 h-9 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Form Content */}
            <form onSubmit={handleEditJob} className="flex flex-col flex-1 min-h-0">
              <div className="overflow-y-auto flex-1 p-6 sm:p-8 custom-scrollbar">
                {editJobError && (
                  <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-xl text-sm flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <span>{editJobError}</span>
                  </div>
                )}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                  
                  {/* Column 1: Project Overview & Timeline */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b border-white/5">
                      <Briefcase className="w-4 h-4 text-[#7c3bed]" />
                      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Project Overview</h3>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Job Title</label>
                      <input 
                        type="text" 
                        value={editTitle} 
                        onChange={(e) => setEditTitle(e.target.value)} 
                        className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-[#7c3bed]/50 transition-all" 
                        required 
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Description</label>
                      <textarea 
                        value={editDescription} 
                        onChange={(e) => setEditDescription(e.target.value)} 
                        className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-[#7c3bed]/50 resize-none h-28 transition-all" 
                        placeholder="Project scope, client notes, or milestone details..."
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Start Date</label>
                        <input 
                          type="date" 
                          value={editStartDate} 
                          onChange={(e) => setEditStartDate(e.target.value)} 
                          className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-[#7c3bed]/50" 
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">End Date</label>
                        <input 
                          type="date" 
                          value={editEndDate} 
                          onChange={(e) => setEditEndDate(e.target.value)} 
                          className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-[#7c3bed]/50" 
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Project Mode</label>
                      <div className="flex bg-black/20 p-1 rounded-xl border border-white/10">
                        <button 
                          type="button" 
                          onClick={() => setEditMode('expense')} 
                          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${editMode === 'expense' ? 'bg-[#7c3bed] text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                        >
                          Expense Tracking
                        </button>
                        <button 
                          type="button" 
                          onClick={() => setEditMode('budget')} 
                          className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${editMode === 'budget' ? 'bg-emerald-500 text-white shadow-lg' : 'text-gray-400 hover:text-white'}`}
                        >
                          Budget Management
                        </button>
                      </div>
                    </div>

                    {/* Google Calendar Sync */}
                    <div className="pt-2">
                      <label className="flex items-center justify-between p-3.5 bg-black/20 border border-white/5 rounded-2xl cursor-pointer hover:border-white/10 transition-colors">
                        <div className="flex flex-col pr-4">
                          <span className="text-white font-medium text-sm flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-blue-400" /> Sync Individual Expenses
                          </span>
                          <span className="text-xs text-gray-500">Automatically sync transactions to your Google Calendar</span>
                        </div>
                        <div className="relative shrink-0">
                          <input 
                            type="checkbox" 
                            className="sr-only peer"
                            checked={editSyncExpenses}
                            onChange={(e) => setEditSyncExpenses(e.target.checked)}
                          />
                          <div className="w-11 h-6 bg-gray-700 rounded-full peer peer-checked:bg-blue-500 transition-colors"></div>
                          <div className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5"></div>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Column 2: Client & Invoicing Details */}
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 pb-2 border-b border-white/5">
                      <FileText className="w-4 h-4 text-emerald-400" />
                      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Client & Invoicing Details</h3>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Client Name</label>
                        <input 
                          type="text" 
                          value={editClientName} 
                          onChange={(e) => setEditClientName(e.target.value)} 
                          className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-[#7c3bed]/50" 
                          placeholder="e.g. Acme Corporation" 
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Client Email</label>
                        <input 
                          type="email" 
                          value={editClientEmail} 
                          onChange={(e) => setEditClientEmail(e.target.value)} 
                          className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-[#7c3bed]/50" 
                          placeholder="billing@acme.com" 
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Client Address</label>
                      <input 
                        type="text" 
                        value={editClientAddress} 
                        onChange={(e) => setEditClientAddress(e.target.value)} 
                        className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-[#7c3bed]/50" 
                        placeholder="123 Business St, Suite 100" 
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Invoice Tag</label>
                        <select
                          value={editInvoiceTag}
                          onChange={(e) => handleEditTagChange(e.target.value)}
                          className="w-full bg-[#1c172d] border border-white/10 rounded-xl px-3 py-3 text-white text-sm focus:ring-2 focus:ring-[#7c3bed]/50"
                        >
                          <option value="">[Default] ({invoiceTemplate?.default_prefix || 'INV'})</option>
                          {globalTags.map(t => (
                            <option key={t.id} value={t.name}>{t.name.toUpperCase()}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Invoice #</label>
                        <input 
                          type="text" 
                          value={editInvoiceNumber} 
                          onChange={(e) => {
                            setEditInvoiceNumber(e.target.value.toUpperCase());
                            setEditJobError('');
                          }}
                          className="w-full bg-black/20 border border-white/10 px-4 py-3 text-indigo-300 font-mono text-sm rounded-xl focus:ring-2 focus:ring-[#7c3bed]/50" 
                          placeholder="e.g. INV-A00001"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">Hourly Rate ($)</label>
                        <input 
                          type="number" 
                          step="0.01" 
                          value={editJobRate} 
                          onChange={(e) => setEditJobRate(e.target.value)} 
                          className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-[#7c3bed]/50" 
                          placeholder="75.00" 
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Invoice Notes & Terms</label>
                      <textarea 
                        value={editInvoiceNotes} 
                        onChange={(e) => setEditInvoiceNotes(e.target.value)} 
                        className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-[#7c3bed]/50 resize-none h-28 transition-all" 
                        placeholder="Terms: Payment due within 30 days. Thank you for your business!" 
                      />
                    </div>
                  </div>

                </div>
              </div>

              {/* Footer (Fixed) */}
              <div className="flex justify-end space-x-3 p-5 sm:p-6 border-t border-white/10 bg-[#161224]/80 backdrop-blur-sm shrink-0">
                <button 
                  type="button" 
                  onClick={() => setIsEditJobModalOpen(false)} 
                  className="px-5 py-2.5 rounded-xl font-medium text-gray-300 hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={isEditingJob} 
                  className="bg-[#7c3bed] hover:bg-[#6b33cc] text-white px-6 py-2.5 rounded-xl font-medium shadow-lg disabled:opacity-50 transition-all flex items-center gap-2"
                >
                  {isEditingJob ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Subscriptions Modal */}
      {isSubModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-[#1c172d] border border-white/10 rounded-3xl p-8 w-full max-w-2xl shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold flex items-center gap-2"><RefreshCw className="w-6 h-6 text-[#7c3bed]" /> Active Subscriptions</h2>
              <button onClick={() => setIsSubModalOpen(false)} className="text-gray-500 hover:text-white transition-colors"><Plus className="w-6 h-6 rotate-45" /></button>
            </div>
            
            <div className="overflow-y-auto flex-1 pr-2 space-y-3">
              {subscriptions.length === 0 ? (
                <div className="text-center py-10 text-gray-500">No active subscriptions found.</div>
              ) : (
                subscriptions.map(sub => (
                  <div key={sub.id} className="bg-black/20 border border-white/5 rounded-xl p-4 flex justify-between items-center">
                    <div>
                      <div className="font-medium text-white mb-1">{sub.description}</div>
                      <div className="text-sm text-gray-400 flex items-center gap-3">
                        <span className={sub.entry_type === 'income' ? 'text-emerald-400' : 'text-rose-400'}>
                          {sub.entry_type === 'income' ? '+' : '-'}${sub.amount.toFixed(2)}
                        </span>
                        <span>•</span>
                        <span className="uppercase tracking-wide text-xs">{sub.frequency}</span>
                        <span>•</span>
                        <span>Next: {new Date(sub.next_generation_date).toLocaleDateString()}</span>
                      </div>
                      <div className="flex gap-2 mt-2">
                        {sub.remind_1_day_before === 1 && (
                          <span className="px-2 py-0.5 bg-[#7c3bed]/20 text-[#a78bfa] text-[10px] font-semibold rounded border border-[#7c3bed]/30">Remind 1d before</span>
                        )}
                        {sub.remind_2_days_before === 1 && (
                          <span className="px-2 py-0.5 bg-[#7c3bed]/20 text-[#a78bfa] text-[10px] font-semibold rounded border border-[#7c3bed]/30">Remind 2d before</span>
                        )}
                        {sub.remind_7_days_before === 1 && (
                          <span className="px-2 py-0.5 bg-[#7c3bed]/20 text-[#a78bfa] text-[10px] font-semibold rounded border border-[#7c3bed]/30">Remind 1w before</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleTerminateSubscription(sub.id)}
                      className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-sm font-medium rounded-lg transition-colors"
                    >
                      Terminate
                    </button>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* Members Modal */}
      {isMembersModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-[#1c172d] border border-white/10 rounded-3xl p-8 w-full max-w-lg shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold flex items-center gap-2"><ListTree className="w-6 h-6 text-blue-400" /> Job Members</h2>
              <button onClick={() => setIsMembersModalOpen(false)} className="text-gray-500 hover:text-white transition-colors"><Plus className="w-6 h-6 rotate-45" /></button>
            </div>
            
            <div className="overflow-y-auto flex-1 pr-2 space-y-3">
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-500/30 flex items-center justify-center text-sm font-bold text-blue-200">
                    You
                  </div>
                  <div>
                    <div className="font-medium text-white">{user?.username}</div>
                    <div className="text-sm text-blue-400">Creator</div>
                  </div>
                </div>
              </div>

              {members.length === 0 ? (
                <div className="text-center py-6 text-gray-500 text-sm">No other members yet. Use “Copy invite” to create a one-time invite code (valid 7 days), share it, then approve the person here.</div>
              ) : (
                members.map(member => (
                  <div key={member.id} className="bg-black/20 border border-white/5 rounded-xl p-4 flex flex-wrap justify-between items-center hover:bg-black/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-700 to-gray-600 flex items-center justify-center text-sm font-bold text-gray-300">
                        {member.username.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium text-white flex items-center gap-2">
                          {member.username}
                        </div>
                        <div className="text-xs text-gray-400">{member.email || 'No email'}</div>
                      </div>
                    </div>
                    {member.pending && job.created_by === user?.id && member.public_key && (
                      <MemberApproval jobId={job.id} member={member} onApproved={fetchMembers} />
                    )}
                    {member.pending && !member.public_key && (
                      <span className="text-xs text-amber-400">Must upgrade their account first</span>
                    )}
                    {job.created_by === user?.id && (
                      <button
                        onClick={() => handleEvictMember(member.id)}
                        className="p-2 hover:bg-rose-500/20 text-gray-500 hover:text-rose-400 rounded-lg transition-colors"
                        title="Evict Member"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* ── AI Notes Modal ────────────────────────────── */}
      {isNotesModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-[#1c172d] border border-white/10 rounded-2xl p-6 w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl relative"
          >
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                  <Bot className="w-5 h-5 text-indigo-400" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    AI Research Notes
                  </h3>
                  <p className="text-sm text-gray-400">Hermes Autonomous Agent</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {isEditingNotes ? (
                  <>
                    <button
                      onClick={() => {
                        setEditedNotes(aiNotes);
                        setIsEditingNotes(false);
                      }}
                      className="px-4 py-2 rounded-xl text-sm font-medium text-gray-400 hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveNotes}
                      disabled={isSavingNotes}
                      className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-medium shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-50"
                    >
                      {isSavingNotes ? 'Saving...' : 'Save Notes'}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setIsEditingNotes(true)}
                    className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                  >
                    <FileText className="w-4 h-4" />
                    Edit Notes
                  </button>
                )}
                <div className="w-px h-6 bg-white/10 mx-1"></div>
                <button
                  onClick={() => setIsNotesModalOpen(false)}
                  className="p-2 hover:bg-white/5 rounded-xl text-gray-400 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
              {isEditingNotes ? (
                <textarea
                  value={editedNotes}
                  onChange={(e) => setEditedNotes(e.target.value)}
                  className="w-full h-full min-h-[400px] bg-black/20 border border-white/10 rounded-xl p-4 text-gray-300 font-mono text-sm focus:outline-none focus:border-indigo-500/50 resize-none"
                  placeholder="Add your markdown notes here..."
                />
              ) : (
                <div className="bg-black/20 rounded-xl p-6 border border-white/5 prose prose-invert max-w-none">
                  <MarkdownRenderer content={aiNotes} />
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* Invoice Modal */}
      {isInvoiceModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#1c172d] border border-white/10 rounded-2xl sm:rounded-3xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden relative my-auto"
          >
            {/* Modal Header */}
            <div className="p-4 sm:p-6 border-b border-white/10 flex justify-between items-center bg-black/20 shrink-0">
              <div>
                <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2 text-white">
                  <FileText className="w-5 h-5 text-indigo-400" /> Generate Invoice
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">Customize invoice settings and review live preview below</p>
              </div>
              <button 
                onClick={() => setIsInvoiceModalOpen(false)} 
                className="text-gray-400 hover:text-white p-1.5 rounded-xl hover:bg-white/5 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {/* Modal Scrollable Body */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 custom-scrollbar">
              {invoiceModalError && (
                <div className="p-4 bg-rose-500/10 border border-rose-500/30 text-rose-400 rounded-xl text-sm flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                  <span>{invoiceModalError}</span>
                </div>
              )}
              {invoiceModalSuccess && (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-xl text-sm flex items-center gap-2">
                  <Check className="w-5 h-5 shrink-0" />
                  <span>Invoice details saved successfully!</span>
                </div>
              )}
              {!invoiceTemplate?.company_name && (
                <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-amber-200 rounded-xl text-xs sm:text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <strong>Missing Setup:</strong> You haven't configured your company details for invoices yet. Configure your company name, logo, prefix, and terms in settings.
                  </div>
                  <Link
                    to="/settings#invoice"
                    className="shrink-0 px-3.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 rounded-xl text-xs font-medium transition-colors border border-amber-500/30 inline-flex items-center gap-1.5 self-start sm:self-auto"
                  >
                    <span>Open Settings</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Link>
                </div>
              )}

              {/* Settings: 2 Column Grid on Desktop, 1 Column on Mobile */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Left Column: Labor Hours & Rate + Client Info */}
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Invoice Tag / Category</label>
                      <select
                        value={invoiceTag}
                        onChange={(e) => handleInvoiceTagChange(e.target.value)}
                        className="w-full bg-[#1c172d] border border-white/10 rounded-xl px-3 py-3 text-white text-sm focus:ring-2 focus:ring-[#7c3bed]/50"
                      >
                        <option value="">[Default] ({invoiceTemplate?.default_prefix || 'INV'})</option>
                        {globalTags.map(t => (
                          <option key={t.id} value={t.name}>{t.name.toUpperCase()}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Invoice #</label>
                      <input
                        type="text"
                        value={invoiceNumber}
                        onChange={(e) => {
                          setInvoiceNumber(e.target.value.toUpperCase());
                          setInvoiceModalError('');
                        }}
                        className="w-full bg-black/20 border border-white/10 px-4 py-3 text-indigo-300 font-mono text-sm rounded-xl focus:ring-2 focus:ring-[#7c3bed]/50"
                        placeholder="e.g. INV-A00001"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Total Labor Hours</label>
                      <input
                        type="number"
                        value={invoiceTotalLaborHours}
                        onChange={(e) => setInvoiceTotalLaborHours(e.target.value)}
                        className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:ring-2 focus:ring-[#7c3bed]/50"
                        placeholder="0.0"
                        step="0.1"
                        min="0"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-300 mb-2">Hourly Labor Rate ($/hr)</label>
                      <input
                        type="number"
                        value={invoiceHourlyRate}
                        onChange={(e) => setInvoiceHourlyRate(e.target.value)}
                        className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:ring-2 focus:ring-[#7c3bed]/50"
                        placeholder="75.00"
                        step="0.01"
                        min="0"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">Client Summary</label>
                    <div className="p-4 border border-white/5 bg-black/20 rounded-xl text-xs sm:text-sm text-gray-300 space-y-1.5">
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-semibold text-gray-400 uppercase tracking-wider text-[11px]">Client Details</span>
                        {job.created_by === user?.id && (
                          <button
                            type="button"
                            onClick={() => { setIsInvoiceModalOpen(false); openEditJobModal(); }}
                            className="text-indigo-400 hover:text-indigo-300 text-xs transition-colors"
                          >
                            Edit Client in Job
                          </button>
                        )}
                      </div>
                      <p><span className="text-gray-400">Name:</span> {job.client_name || <span className="italic text-gray-500">Not set</span>}</p>
                      <p><span className="text-gray-400">Address:</span> {job.client_address || <span className="italic text-gray-500">Not set</span>}</p>
                      <p><span className="text-gray-400">Email:</span> {job.client_email || <span className="italic text-gray-500">Not set</span>}</p>
                    </div>
                  </div>
                </div>

                {/* Right Column: Invoice Notes & Terms */}
                <div className="flex flex-col">
                  <label className="block text-sm font-medium text-gray-300 mb-2">Invoice Notes & Terms</label>
                  <textarea
                    value={invoiceNotes}
                    onChange={(e) => setInvoiceNotes(e.target.value)}
                    className="w-full flex-1 min-h-[140px] bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-[#7c3bed]/50 resize-none text-sm transition-all"
                    placeholder="Terms: Payment due within 30 days. Thank you for your business!"
                  />
                  <p className="text-[11px] text-gray-400 mt-2">Appears at the footer of the generated invoice sheet.</p>
                </div>
              </div>

              {/* Invoice Preview Section (at bottom after all settings) */}
              <div className="pt-4 border-t border-white/10">
                <InvoicePreview
                  job={{
                    ...job,
                    job_rate: parseFloat(invoiceHourlyRate) || 0,
                    invoice_notes: invoiceNotes,
                    invoice_tag: invoiceTag,
                    invoice_number: invoiceNumber,
                  }}
                  expenses={expenses}
                  template={invoiceTemplate}
                  totalLaborHours={parseFloat(invoiceTotalLaborHours) || 0}
                  hourlyRate={parseFloat(invoiceHourlyRate) || 0}
                  invoiceNotes={invoiceNotes}
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 sm:p-6 border-t border-white/10 flex flex-wrap items-center justify-between gap-3 bg-black/20 shrink-0">
              <div className="text-xs sm:text-sm text-gray-400">
                <span className="text-gray-300 font-medium">Labor:</span> ${( (parseFloat(invoiceHourlyRate) || 0) * (parseFloat(invoiceTotalLaborHours) || 0) ).toFixed(2)}
                <span className="mx-2 text-white/20">|</span>
                <span className="text-gray-300 font-medium">Grand Total:</span> ${(
                  (expenses.filter(e => e.entry_type === 'expense').reduce((sum, e) => sum + (Number(e.amount) || 0), 0)) +
                  ((parseFloat(invoiceHourlyRate) || 0) * (parseFloat(invoiceTotalLaborHours) || 0))
                ).toFixed(2)}
              </div>
              <div className="flex items-center gap-3 ml-auto">
                <button
                  type="button"
                  onClick={() => setIsInvoiceModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={(e) => handleSaveInvoiceDetails(e)}
                  disabled={isSavingInvoice}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium bg-white/10 hover:bg-white/15 text-white transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  <span>Save Details</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadInvoice}
                  disabled={isSavingInvoice}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium bg-indigo-500 text-white hover:bg-indigo-600 transition-colors flex items-center gap-2 shadow-sm disabled:opacity-50"
                >
                  {isSavingInvoice ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  <span>{isSavingInvoice ? 'Generating PDF...' : 'Download PDF'}</span>
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Hidden Invoice Generator (Rendered for Canvas) */}
      <InvoiceGenerator
        ref={invoiceRef}
        job={{
          ...job,
          job_rate: parseFloat(invoiceHourlyRate) || 0,
          invoice_notes: invoiceNotes,
          invoice_tag: invoiceTag,
          invoice_number: invoiceNumber,
        }}
        expenses={expenses}
        template={invoiceTemplate}
        totalLaborHours={parseFloat(invoiceTotalLaborHours) || 0}
        hourlyRate={parseFloat(invoiceHourlyRate) || 0}
        invoiceNotes={invoiceNotes}
      />

    </div>
  );
}
