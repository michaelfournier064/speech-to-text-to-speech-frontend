import { useCallback, useEffect, useMemo, useState } from 'react';
import './App.css';

const POLL_INTERVAL_MS = 2000;

const parseVoices = (value) => {
  if (Array.isArray(value)) {
    return value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

const runtimeConfig = window.__APP_CONFIG__ || {};
const envApiBaseUrl = (process.env.REACT_APP_API_BASE_URL || '').trim();
const envVoices = parseVoices(process.env.REACT_APP_VOICES);
const runtimeVoices = parseVoices(runtimeConfig.voices);
const configuredVoices = envVoices.length ? envVoices : runtimeVoices;
const initialApiBaseUrl = envApiBaseUrl || (runtimeConfig.apiBaseUrl || '').trim();

function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState(initialApiBaseUrl);
  const [selectedFile, setSelectedFile] = useState(null);
  const [availableVoices, setAvailableVoices] = useState(configuredVoices);
  const [voice, setVoice] = useState(configuredVoices[0] || '');
  const [job, setJob] = useState(null);
  const [outputAudioUrl, setOutputAudioUrl] = useState('');
  const [isOutputAudioLoading, setIsOutputAudioLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [apiBaseTouched] = useState(Boolean(initialApiBaseUrl));
  const selectedFileAudioUrl = useMemo(() => {
    if (!selectedFile) {
      return '';
    }

    return URL.createObjectURL(selectedFile);
  }, [selectedFile]);

  const buildApiUrl = useCallback(
    (path) => {
      const trimmedBase = apiBaseUrl.trim().replace(/\/$/, '');
      return trimmedBase ? `${trimmedBase}${path}` : path;
    },
    [apiBaseUrl]
  );

  useEffect(() => {
    const shouldLoadServerConfig = !envApiBaseUrl || envVoices.length === 0;

    if (!shouldLoadServerConfig) {
      return undefined;
    }

    let isActive = true;

    const loadServerConfig = async () => {
      try {
        const response = await fetch('/widget-config.json', { cache: 'no-store' });

        if (!response.ok) {
          return;
        }

        const data = await response.json();
        const configVoices = parseVoices(data?.voices);

        if (!isActive) {
          return;
        }

        if (!envApiBaseUrl && !apiBaseTouched && typeof data?.apiBaseUrl === 'string') {
          setApiBaseUrl(data.apiBaseUrl.trim());
        }

        if (envVoices.length === 0 && configVoices.length > 0) {
          setAvailableVoices(configVoices);
          setVoice((currentVoice) =>
            configVoices.includes(currentVoice) ? currentVoice : configVoices[0]
          );
        }
      } catch {
        // Ignore missing runtime config and fall back to defaults.
      }
    };

    loadServerConfig();

    return () => {
      isActive = false;
    };
  }, [apiBaseTouched]);

  const jobId = job?.id;
  const isTerminalState = job?.status === 'completed' || job?.status === 'failed';
  const apiOutputAudioUrl = useMemo(() => {
    if (!jobId) {
      return '';
    }

    return buildApiUrl(`/v1/speech-jobs/${jobId}/output-audio`);
  }, [buildApiUrl, jobId]);

  useEffect(() => {
    return () => {
      if (outputAudioUrl) {
        URL.revokeObjectURL(outputAudioUrl);
      }
    };
  }, [outputAudioUrl]);

  useEffect(() => {
    return () => {
      if (selectedFileAudioUrl) {
        URL.revokeObjectURL(selectedFileAudioUrl);
      }
    };
  }, [selectedFileAudioUrl]);

  useEffect(() => {
    if (!jobId || isTerminalState) {
      return undefined;
    }

    const pollJob = async () => {
      try {
        const response = await fetch(
          buildApiUrl(`/v1/speech-jobs/${jobId}`)
        );
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.detail || 'Failed to refresh job status.');
        }

        setJob(data);
      } catch (error) {
        setErrorMessage(error.message || 'Unable to fetch job status.');
      }
    };

    const timerId = setInterval(pollJob, POLL_INTERVAL_MS);
    pollJob();

    return () => clearInterval(timerId);
  }, [buildApiUrl, isTerminalState, jobId]);

  useEffect(() => {
    if (job?.status !== 'completed' || !jobId || outputAudioUrl) {
      return undefined;
    }

    let isActive = true;
    setIsOutputAudioLoading(true);

    const loadOutputAudio = async () => {
      try {
        const response = await fetch(apiOutputAudioUrl);

        if (!response.ok) {
          throw new Error('Failed to download output audio.');
        }

        const audioBlob = await response.blob();
        const nextUrl = URL.createObjectURL(audioBlob);

        if (!isActive) {
          URL.revokeObjectURL(nextUrl);
          return;
        }

        setOutputAudioUrl(nextUrl);
      } catch (error) {
        if (isActive) {
          setErrorMessage(error.message || 'Unable to retrieve output audio.');
        }
      } finally {
        if (isActive) {
          setIsOutputAudioLoading(false);
        }
      }
    };

    loadOutputAudio();

    return () => {
      isActive = false;
    };
  }, [apiOutputAudioUrl, job?.status, jobId, outputAudioUrl]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage('');

    if (!selectedFile) {
      setErrorMessage('Select an audio file before submitting.');
      return;
    }

    if (!voice) {
      setErrorMessage('No voice is configured. Set REACT_APP_VOICES or server config.');
      return;
    }

    setIsSubmitting(true);

    try {
      if (outputAudioUrl) {
        URL.revokeObjectURL(outputAudioUrl);
      }

      setOutputAudioUrl('');
      setIsOutputAudioLoading(false);
      setJob(null);

      const response = await fetch(
        buildApiUrl('/v1/speech-jobs'),
        {
          method: 'POST',
          body: (() => {
            const formData = new FormData();
            formData.append('file', selectedFile);
            formData.append('voice', voice);
            return formData;
          })(),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.detail || 'Failed to create speech job.');
      }

      setJob(data);
    } catch (error) {
      setErrorMessage(error.message || 'Failed to submit speech job.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="app-shell">
      <main className="card">
        <div className="hero">
          <p className="eyebrow">Speech Demo</p>
          <h1>Speech-to-Text-to-Speech Playground</h1>
          <p className="subtext">
            Upload an audio file, track stage status, and retrieve generated output audio.
          </p>
        </div>

        <form className="speech-form" onSubmit={handleSubmit}>
          <label htmlFor="audio-file">Audio file</label>
          <input
            id="audio-file"
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg"
            onChange={(event) => setSelectedFile(event.target.files?.[0] || null)}
            required
          />

          {selectedFileAudioUrl ? (
            <div className="transcript">
              <h3>Input Audio Preview</h3>
              <p>{selectedFile?.name || 'Selected file'}</p>
              <audio controls src={selectedFileAudioUrl} preload="metadata" />
            </div>
          ) : null}

          <label htmlFor="voice">Voice</label>
          <select
            id="voice"
            value={voice}
            onChange={(event) => setVoice(event.target.value)}
            required
          >
            {availableVoices.length === 0 ? (
              <option value="" disabled>
                No voices configured
              </option>
            ) : null}
            {availableVoices.map((voiceOption) => (
              <option key={voiceOption} value={voiceOption}>
                {voiceOption}
              </option>
            ))}
          </select>

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Submitting...' : 'Create Speech Job'}
          </button>
        </form>

        {errorMessage ? <p className="error-banner">{errorMessage}</p> : null}

        {job ? (
          <section className="job-card" aria-live="polite">
            <h2>Job Status</h2>
            <div className="job-grid">
              <div>
                <span className="label">Job ID</span>
                <span>{job.id}</span>
              </div>
              <div>
                <span className="label">Status</span>
                <span className={`pill ${job.status}`}>{job.status}</span>
              </div>
              <div>
                <span className="label">Stage</span>
                <span>{job.stage || 'n/a'}</span>
              </div>
              <div>
                <span className="label">Updated</span>
                <span>{job.updated_at || 'n/a'}</span>
              </div>
            </div>

            {job.transcript ? (
              <div className="transcript">
                <h3>Transcript</h3>
                <p>{job.transcript}</p>
              </div>
            ) : null}

            {job.error_message ? (
              <p className="error-text">{job.error_message}</p>
            ) : null}

            {job.status === 'completed' ? (
              <>
                {isOutputAudioLoading ? (
                  <p className="muted">Retrieving output audio...</p>
                ) : null}
                {outputAudioUrl ? (
                  <>
                    <audio controls src={outputAudioUrl} preload="metadata" />
                    <a href={outputAudioUrl} className="download-link" download={`speech-job-${job.id}.wav`}>
                      Download output audio
                    </a>
                  </>
                ) : (
                  <a href={apiOutputAudioUrl} className="download-link">
                    Download output audio
                  </a>
                )}
              </>
            ) : (
              <p className="muted">Polling for updates every 2 seconds...</p>
            )}
          </section>
        ) : null}
      </main>
    </div>
  );
}

export default App;
