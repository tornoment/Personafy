package com.tornoment.personafy;

import android.media.AudioManager;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.coordinatorlayout.widget.CoordinatorLayout;
import com.getcapacitor.BridgeActivity;

/* The player's window. The page itself is the same as on the iPhone (mobile/www); here only:
   - the notification / lock-screen player (MediaPlugin + PlaybackService);
   - the phone's volume buttons always change the music's volume;
   - the back button/gesture closes panels and steps back through the screens (app.js backStep);
     on the home screen it sends the app to the background instead of closing it, so the music keeps playing;
   - on a tablet or an unfolded phone the page stays phone-shaped: a centred column on the dark background.
     Android 16 no longer keeps such screens in portrait, and the phone layout stretched across a landscape
     tablet falls apart; older Android letterboxes the app by itself, so this draws the same on newer ones. */
public class MainActivity extends BridgeActivity {

    private static final String BACK_JS =
        "(function(){try{return !!(window.personafyBack&&window.personafyBack())}catch(e){return false}})()";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaPlugin.class);
        super.onCreate(savedInstanceState);
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = bridge != null ? bridge.getWebView() : null;
                if (web == null) {
                    moveTaskToBack(true);
                    return;
                }
                web.evaluateJavascript(BACK_JS, (handled) -> {
                    if (!"true".equals(handled)) moveTaskToBack(true);
                });
            }
        });
        WebView web = bridge != null ? bridge.getWebView() : null;
        if (web != null && web.getParent() instanceof View) {
            ((View) web.getParent()).addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> {
                if (r - l != or - ol || b - t != ob - ot) v.post(() -> fitColumn(web, r - l, b - t));
            });
        }
    }

    /* the widest the page gets: a tall phone's proportions (9 : 14.5), on screens at least 600dp across */
    private void fitColumn(WebView web, int w, int h) {
        int width = ViewGroup.LayoutParams.MATCH_PARENT;
        if (getResources().getConfiguration().smallestScreenWidthDp >= 600) {
            int column = Math.round(h * 9f / 14.5f);
            if (column < w) width = column;
        }
        ViewGroup.LayoutParams lp = web.getLayoutParams();
        if (lp == null || lp.width == width) return;
        lp.width = width;
        if (lp instanceof CoordinatorLayout.LayoutParams) ((CoordinatorLayout.LayoutParams) lp).gravity = Gravity.CENTER_HORIZONTAL;
        web.setLayoutParams(lp);
    }
}
