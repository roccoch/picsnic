import { useState, useEffect } from "react";
import { supabase } from "./supabase.js";
import './App.css';

// Derive the Edge Functions base URL from the Supabase project URL
// (https://<ref>.supabase.co -> https://<ref>.functions.supabase.co)
const FUNCTIONS_URL = import.meta.env.VITE_SUPABASE_URL
    .replace(".supabase.co", ".functions.supabase.co");

const isVideo = (photo) =>
    photo.media_type === "video" || /\.(mp4|mov|webm|avi|mkv)$/i.test(photo.url);

const App = () => {
    const [selectedPhoto, setSelectedPhoto] = useState(null);
    const [photos, setPhotos] = useState([]);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [user, setUser] = useState(null);
    const [loadingAuth, setLoadingAuth] = useState(true);

    const [galleryId, setGalleryId] = useState(null);
    const [galleryName, setGalleryName] = useState("");
    const [enteredPin, setEnteredPin] = useState("");
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [pinError, setPinError] = useState("");

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            if (session?.user) {
                setUser(session.user);
                const savedGalleryId = localStorage.getItem('galleryId');
                if (savedGalleryId) {
                    setGalleryId(savedGalleryId);
                    setIsAuthorized(true);
                }
            }
            setLoadingAuth(false);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (_event, session) => {
                setUser(session?.user ?? null);
            }
        );

        return () => subscription.unsubscribe();
    }, []);

    useEffect(() => {
        if (!isAuthorized || !galleryId) return;

        const fetchPhotos = async () => {
            const { data, error } = await supabase
                .from('photos')
                .select('*')
                .eq('gallery_id', galleryId)
                .order('created_at', { ascending: false });

            if (error) console.error("Error fetching photos:", error);
            else setPhotos(data);
        };
        fetchPhotos();
    }, [isAuthorized, galleryId]);

    // PIN verification happens SERVER-SIDE. The galleries table has no public
    // read policy, so PINs can never be dumped through the Supabase API.
    const handlePinLogin = async () => {
        setPinError("");

        try {
            const response = await fetch(`${FUNCTIONS_URL}/verify-gallery-pin`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ galleryId, pin: enteredPin })
            });
            const data = await response.json();

            if (!response.ok) {
                setPinError(data.error || "Invalid gallery ID or PIN.");
                return;
            }

            const { error: signInError } = await supabase.auth.signInAnonymously();
            if (signInError) {
                setPinError(`Error signing in: ${signInError.message}`);
                return;
            }

            localStorage.setItem('galleryId', data.galleryId);
            setGalleryId(data.galleryId);
            setGalleryName(data.name || "");
            setIsAuthorized(true);
        } catch {
            setPinError("Network error. Please try again.");
        }
    };

    const handleLogout = async () => {
        await supabase.auth.signOut();
        localStorage.removeItem('galleryId');
        setIsAuthorized(false);
        setPhotos([]);
        setEnteredPin("");
        setGalleryId(null);
        setGalleryName("");
    };

    const handleUpload = async (e) => {
        const file = e.target.files[0];
        e.target.value = ""; // allow re-uploading the same file
        if (!file) return;
        setIsUploading(true);

        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `photos/${crypto.randomUUID()}.${fileExt}`;

            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;

            const response = await fetch(`${FUNCTIONS_URL}/generate-upload-url`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({
                    fileName,
                    contentType: file.type,
                    fileSize: file.size
                })
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Failed to get upload URL");

            await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();

                xhr.open('PUT', data.signedUrl, true);
                // MUST match the ContentType baked into the signature
                xhr.setRequestHeader('Content-Type', file.type);

                xhr.upload.onprogress = (event) => {
                    if (event.lengthComputable) {
                        setUploadProgress((event.loaded / event.total) * 100);
                    }
                };
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) resolve(xhr);
                    else reject(new Error(`Upload to R2 failed: ${xhr.status} - ${xhr.responseText}`));
                };
                xhr.onerror = () => reject(new Error(`Upload to R2 failed: ${xhr.status} - ${xhr.responseText}`));
                xhr.send(file);
            });

            // Insert the DB row and immediately show the new media
            const { data: newPhoto, error: insertError } = await supabase
                .from('photos')
                .insert({
                    title: file.name,
                    url: data.publicUrl,
                    gallery_id: galleryId,
                    photographer_id: user.id,
                    media_type: file.type.startsWith('video/') ? 'video' : 'image'
                })
                .select()
                .single();

            if (insertError) throw insertError;
            setPhotos((prev) => [newPhoto, ...prev]);
        } catch (error) {
            console.error("Upload failed:", error);
            alert(error.message);
        } finally {
            setIsUploading(false);
            setUploadProgress(0);
        }
    };

    // Deletes the R2 object AND the DB row via the edge function
    // (only allowed for the user who uploaded the file).
    const handleDelete = async (photo) => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const response = await fetch(`${FUNCTIONS_URL}/delete-file`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${session?.access_token}`
                },
                body: JSON.stringify({ photoId: photo.id })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Delete failed");

            setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
            setSelectedPhoto(null);
        } catch (error) {
            console.error("Delete failed:", error);
            alert(error.message);
        }
    };

    // The browser's `download` attribute is ignored for cross-origin URLs,
    // so we fetch the file as a blob and download it via an object URL.
    const handleDownload = async (photo) => {
        try {
            const res = await fetch(photo.url);
            if (!res.ok) throw new Error("Download failed");
            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = photo.title || "download";
            a.click();
            URL.revokeObjectURL(a.href);
        } catch (error) {
            console.error(error);
            window.open(photo.url, '_blank');
        }
    };

    if (loadingAuth) {
        return <div style={{ textAlign: 'center', padding: '50px' }}>Loading...</div>;
    }

    if (!isAuthorized) {
        return (
            <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                    <h1>Picsnic</h1>
                    <p className="subtitle" style={{ marginBottom: '30px' }}>Client Gallery Login</p>

                    <input
                        type="text"
                        placeholder="Gallery ID"
                        value={galleryId || ""}
                        onChange={(e) => setGalleryId(e.target.value)}
                        style={{ display: 'block', margin: '10px auto', padding: '10px', borderRadius: '8px', border: '1px solid #ccc', width: '300px' }}
                    />
                    <input
                        type="password"
                        placeholder="Enter 4-digit PIN"
                        value={enteredPin}
                        onChange={(e) => setEnteredPin(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handlePinLogin()}
                        style={{ display: 'block', margin: '10px auto', padding: '10px', borderRadius: '8px', border: '1px solid #ccc', width: '300px' }}
                    />
                    <button
                        onClick={handlePinLogin}
                        className="upload-btn"
                        style={{ fontSize: '16px', padding: '12px 32px', marginTop: '10px' }}
                    >
                        Enter Gallery
                    </button>
                    {pinError && <p style={{ color: 'red', marginTop: '10px' }}>{pinError}</p>}
                </div>
            </div>
        );
    }

    // Main app (logged in)
    return (
    <div className="app-container">
        <header className="app-header">
            <h1>Picsnic</h1>
            <p className="subtitle">Gallery: {galleryName || galleryId}</p>

            <div style={{ marginTop: '15px', display: 'flex', gap: '10px', justifyContent: 'center', alignItems: 'center' }}>
                <input type="file" accept="image/*,video/*" onChange={handleUpload} id="upload-input" style={{ display: 'none' }} />
                <label htmlFor="upload-input" className="upload-btn">
                    {isUploading ? `Uploading... ${Math.round(uploadProgress)}%` : 'Upload Media'}
                </label>

                {isUploading && (
                    <div className="progress-track" style={{ width: '200px', height: '10px', background: '#e0e0e0', borderRadius: '5px', overflow: 'hidden' }}>
                        <div className="progress-fill" style={{ width: `${uploadProgress}%`, height: '100%', background: '#007aff', transition: 'width 0.2s' }} />
                    </div>
                )}

                <button
                    onClick={handleLogout}
                    className="close-btn"
                    style={{ background: '#fff', color: '#333', border: '1px solid #ccc' }}
                >
                    Logout
                </button>
            </div>
        </header>

        <main className="main-content">
            <div className="gallery-grid">
                {photos.map(photo => (
                    <div key={photo.id} className="photo-card" onClick={() => setSelectedPhoto(photo)}>
                        {isVideo(photo)
                            ? <video src={photo.url} muted playsInline preload="metadata" />
                            : <img src={photo.url} alt={photo.title} loading="lazy" />}
                    </div>
                ))}
            </div>
        </main>

        {selectedPhoto && (
            <div className="modal-overlay" onClick={() => setSelectedPhoto(null)}>
                <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                    {isVideo(selectedPhoto)
                        ? <video src={selectedPhoto.url} controls autoPlay style={{ maxWidth: '100%', maxHeight: '80vh' }} />
                        : <img src={selectedPhoto.url} alt={selectedPhoto.title} />}
                    <button onClick={() => handleDownload(selectedPhoto)} className="download-btn" style={{ border: 'none', cursor: 'pointer' }}>Download</button>
                    {user?.id === selectedPhoto.photographer_id && (
                        <button className="close-btn" onClick={() => handleDelete(selectedPhoto)} style={{ background: '#ff3b30', color: '#fff' }}>
                            Delete
                        </button>
                    )}
                    <button className="close-btn" onClick={() => setSelectedPhoto(null)}>Close</button>
                </div>
            </div>
        )}
    </div>
    );
};

export default App;
