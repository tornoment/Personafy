package com.tornoment.personafy;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.drawable.Icon;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;
import androidx.core.content.ContextCompat;

/* Keeps the music going with the screen off and shows the player outside the app.
   The sound itself is the page's <audio> (with the volume levelling of Web Audio), exactly as on the iPhone;
   this service is what Android needs around it:
   - a foreground service of the "media playback" kind while music plays, so the system does not freeze or
     close the app in the background (and a partial wake lock, so the next track is fetched with the screen off);
   - a media session: the player in the notification shade and on the lock screen, the buttons of headphones,
     Bluetooth devices and watches;
   - pulling the headphones out pauses the music.
   Everything it does goes back to the page through MediaPlugin.send(). */
public class PlaybackService extends Service {

    static final String ACTION_PLAY = "com.tornoment.personafy.PLAY";
    static final String ACTION_PAUSE = "com.tornoment.personafy.PAUSE";
    static final String ACTION_NEXT = "com.tornoment.personafy.NEXT";
    static final String ACTION_PREV = "com.tornoment.personafy.PREV";

    private static final String TAG = "Personafy";
    private static final String CHANNEL = "playback";
    private static final int NOTE_ID = 7;
    /* after a pause the service stays in the foreground this long: the gap between two tracks, a quick pause */
    private static final long KEEP_AFTER_PAUSE_MS = 30_000;
    private static final long WAKE_MS = 3 * 3600_000L;

    /* what the page last told (main thread only) */
    static final class State {
        String title = "";
        String artist = "";
        String album = "";
        Bitmap art;
        boolean playing;
        boolean ever;
        long positionMs;
        long durationMs;
        long at;
    }

    static final State state = new State();
    private static PlaybackService instance;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable demoteLater = this::demote;
    private MediaSession session;
    private NotificationManager notes;
    private PowerManager.WakeLock wake;
    private boolean foreground;
    private boolean noisyOn;

    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent != null && AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                MediaPlugin.send("pause", null);
            }
        }
    };

    /* the page's news: refresh the running service, or start it when the music starts */
    static void update(Context ctx) {
        PlaybackService s = instance;
        if (s != null) {
            s.refresh();
            return;
        }
        if (!state.playing) return;
        try {
            ContextCompat.startForegroundService(ctx, new Intent(ctx, PlaybackService.class));
        } catch (Exception e) {
            Log.w(TAG, "could not start the playback service", e);
        }
    }

    /* the app's window is gone (swiped away from the recent apps): the page and its sound are gone too */
    static void shutdown() {
        PlaybackService s = instance;
        if (s != null) s.stopAll();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        notes = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, getString(R.string.playback_channel), NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            notes.createNotificationChannel(ch);
        }
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Personafy:playback");
        wake.setReferenceCounted(false);
        session = new MediaSession(this, "Personafy");
        session.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                MediaPlugin.send("play", null);
            }

            @Override
            public void onPause() {
                MediaPlugin.send("pause", null);
            }

            @Override
            public void onStop() {
                MediaPlugin.send("pause", null);
            }

            @Override
            public void onSkipToNext() {
                MediaPlugin.send("nexttrack", null);
            }

            @Override
            public void onSkipToPrevious() {
                MediaPlugin.send("previoustrack", null);
            }

            @Override
            public void onSeekTo(long pos) {
                MediaPlugin.send("seekto", pos / 1000.0);
            }
        }, main);
        session.setSessionActivity(openApp());
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        /* started with startForegroundService: Android wants startForeground() within seconds, playing or not */
        Notification n = build();
        promote(n);
        refresh();
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        stopAll();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        main.removeCallbacks(demoteLater);
        unregisterNoisy();
        if (wake != null && wake.isHeld()) wake.release();
        if (session != null) {
            session.setActive(false);
            session.release();
        }
        if (instance == this) instance = null;
        super.onDestroy();
    }

    void refresh() {
        if (session == null) return;
        session.setMetadata(metadata());
        session.setPlaybackState(playbackState());
        Notification n = build();
        if (state.playing) {
            main.removeCallbacks(demoteLater);
            promote(n);
            wake.acquire(WAKE_MS);
            registerNoisy();
        } else {
            notes.notify(NOTE_ID, n);
            main.removeCallbacks(demoteLater);
            main.postDelayed(demoteLater, KEEP_AFTER_PAUSE_MS);
        }
    }

    private void promote(Notification n) {
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            else startForeground(NOTE_ID, n);
            foreground = true;
        } catch (Exception e) {
            /* Android 12+ may refuse it from the background; the music still plays, only less protected */
            Log.w(TAG, "startForeground refused", e);
            notes.notify(NOTE_ID, n);
        }
    }

    /* paused for a while: the notification stays (it can be swiped away now), the app is no longer held */
    private void demote() {
        if (state.playing) return;
        if (foreground) {
            if (Build.VERSION.SDK_INT >= 24) stopForeground(Service.STOP_FOREGROUND_DETACH);
            else stopForeground(false);
            foreground = false;
        }
        if (wake.isHeld()) wake.release();
        unregisterNoisy();
        notes.notify(NOTE_ID, build());
    }

    private void stopAll() {
        main.removeCallbacks(demoteLater);
        state.playing = false;
        if (Build.VERSION.SDK_INT >= 24) stopForeground(Service.STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        foreground = false;
        notes.cancel(NOTE_ID);
        stopSelf();
    }

    private void registerNoisy() {
        if (noisyOn) return;
        /* the system's own broadcast: it reaches a not-exported receiver */
        ContextCompat.registerReceiver(this, noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_NOT_EXPORTED);
        noisyOn = true;
    }

    private void unregisterNoisy() {
        if (!noisyOn) return;
        try {
            unregisterReceiver(noisy);
        } catch (Exception e) {
            /* already gone */
        }
        noisyOn = false;
    }

    private MediaMetadata metadata() {
        MediaMetadata.Builder b = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, state.title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, state.artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, state.album);
        if (state.durationMs > 0) b.putLong(MediaMetadata.METADATA_KEY_DURATION, state.durationMs);
        if (state.art != null) {
            b.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, state.art);
            b.putBitmap(MediaMetadata.METADATA_KEY_ART, state.art);
        }
        return b.build();
    }

    private PlaybackState playbackState() {
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
            | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SEEK_TO
            | PlaybackState.ACTION_STOP;
        return new PlaybackState.Builder()
            .setActions(actions)
            .setState(state.playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, state.positionMs,
                state.playing ? 1f : 0f, state.at)
            .build();
    }

    private PendingIntent openApp() {
        Intent i = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (i == null) i = new Intent(this, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        return PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private Notification.Action action(int icon, int title, String what, int code) {
        Intent i = new Intent(this, MediaActionReceiver.class).setAction(what);
        PendingIntent pi = PendingIntent.getBroadcast(this, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Action.Builder(Icon.createWithResource(this, icon), getString(title), pi).build();
    }

    private Notification build() {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_stat_personafy)
            .setContentTitle(state.title)
            .setContentText(state.artist)
            .setSubText(state.album)
            .setContentIntent(openApp())
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .setOngoing(state.playing)
            .setCategory(Notification.CATEGORY_TRANSPORT)
            .setColor(0xFFD4141A)
            .addAction(action(R.drawable.ic_media_prev, R.string.media_prev, ACTION_PREV, 1))
            .addAction(state.playing
                ? action(R.drawable.ic_media_pause, R.string.media_pause, ACTION_PAUSE, 2)
                : action(R.drawable.ic_media_play, R.string.media_play, ACTION_PLAY, 3))
            .addAction(action(R.drawable.ic_media_next, R.string.media_next, ACTION_NEXT, 4))
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        if (state.art != null) b.setLargeIcon(state.art);
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }
}
