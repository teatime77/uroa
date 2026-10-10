import { $, $dlg } from "@i18n";
import { SignUp, SignIn, SignOut, SignUpOk, SignInOk, resetPassword } from "./firebase";

export function setEvent(){
    $("firebase-sign-up").addEventListener("click", SignUp);
    $("firebase-sign-in").addEventListener("click", SignIn);
    $("firebase-sign-out").addEventListener("click", SignOut);

    $("sign-up-ok").addEventListener("click", SignUpOk);
    $("sign-up-cancel").addEventListener("click", (ev : MouseEvent)=>{
        $dlg('sign-up').close();
    });

    $("sign-in-ok").addEventListener("click", SignInOk);
    $("sign-in-reset").addEventListener("click", resetPassword);
    $("sign-in-cancel").addEventListener("click", (ev : MouseEvent)=>{
        $dlg('sign-in').close();
    });
}

export function showFileDlg(){
}

