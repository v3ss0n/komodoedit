/* -*- Mode: JavaScript; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 4 -*- */
/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 * 
 * The contents of this file are subject to the Mozilla Public License
 * Version 1.1 (the "License"); you may not use this file except in
 * compliance with the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 * 
 * Software distributed under the License is distributed on an "AS IS"
 * basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the
 * License for the specific language governing rights and limitations
 * under the License.
 * 
 * The Original Code is Komodo code.
 * 
 * The Initial Developer of the Original Code is ActiveState Software Inc.
 * Portions created by ActiveState Software Inc are Copyright (C) 2000-2007
 * ActiveState Software Inc. All Rights Reserved.
 * 
 * Contributor(s):
 *   ActiveState Software Inc
 * 
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 * 
 * ***** END LICENSE BLOCK ***** */

/*
 * -casper commandline handler; starts unittests.
 */

const nsISupports           = Components.interfaces.nsISupports;
const nsICategoryManager    = Components.interfaces.nsICategoryManager;
const nsIComponentRegistrar = Components.interfaces.nsIComponentRegistrar;
const nsICommandLine        = Components.interfaces.nsICommandLine;
const nsICommandLineHandler = Components.interfaces.nsICommandLineHandler;
const nsIFactory            = Components.interfaces.nsIFactory;
const nsIModule             = Components.interfaces.nsIModule;
const nsIWindowWatcher      = Components.interfaces.nsIWindowWatcher;
const nsIObserver           = Components.interfaces.nsIObserver;
/*
 * Classes
 */


const CasperConsoleHandler = {
    params: [],
    onload: null,
    eot: false,
    logfile: null,
    timeoutafter: 1000 * 60 * 30 /* 30 mins */,
    windowHasOpened: false,
    /* nsISupports */
    QueryInterface : function clh_QI(iid) {
        if (iid.equals(nsICommandLineHandler) ||
            iid.equals(nsIObserver) ||
            iid.equals(nsIFactory) ||
            iid.equals(nsISupports))
            return this;

        throw Components.results.NS_ERROR_NO_INTERFACE;
    },

    /* nsICommandLineHandler */

    handle : function clh_handle(cmdLine) {
        try {
            //dump("Capser clh_handle:: Arguments:\n");
            //for (var i=0; i < cmdLine.length; i++) {
            //    dump("  Argument[" + i + "]: " + cmdLine.getArgument(i) + "\n");
            //}
            if (cmdLine.findFlag("casper", false) < 0) {
                return;
            }
            if (cmdLine.findFlag("eot", false) >= 0) {
                cmdLine.handleFlag("eot", false);
                this.eot = true;
            }
            if (cmdLine.findFlag("logfile", false) >= 0) {
                this.logfile = cmdLine.handleFlagWithParam("logfile", false);
            }
            if (cmdLine.findFlag("timeoutafter", false) >= 0) {
                this.timeoutafter = cmdLine.handleFlagWithParam("timeoutafter", false);
            }
            // Now we just grab everything in the command line
            cmdLine.handleFlag("casper", false);
            for (var i=0; i < cmdLine.length; i++) {
                this.params.push(cmdLine.getArgument(i));
            }
            cmdLine.removeArguments(0, cmdLine.length - 1);
            // we need to wait for the main window to startup before we
            // run any tests
            this.windowWatcher.registerNotification(this);
        } catch(e) {
            dump(e+"\n");
        }
    },

    helpInfo : "       -casper <tests>      start unittests.\n"+
               "       -eot                 exit app when tests completed.\n"+
               "       -logfile             save results to this logfile.\n\n"+
               "  Example: -casper test_something.js#mytestcase.childtest\n",

    /* nsIFactory */

    createInstance : function clh_CI(outer, iid) {
        if (outer != null)
            throw Components.results.NS_ERROR_NO_AGGREGATION;

        return this.QueryInterface(iid);
    },

    lockFactory : function clh_lock(lock) {
        /* no-op */
    },

    get windowWatcher() {
        return Components.classes["@mozilla.org/embedcomp/window-watcher;1"]
                        .getService(Components.interfaces.nsIWindowWatcher);
    },
    
    observe: function(subject, topic, data)
    {
        switch(topic) {
        case "domwindowopened":
            try {
                var domWindow = subject.QueryInterface(Components.interfaces.nsIDOMWindow);
                this.windowWatcher.unregisterNotification(this);
                // now we install an event listener and wait for the load event
                var self = this;

                // Add a quit handler in case the tests take too long.
                var loadhandler = function(event) {
                    try {
                        domWindow.removeEventListener("load", loadhandler, false);
                        domWindow.setTimeout(self.forceQuit, self.timeoutafter);
                    } catch(e) {
                        dump(e+"\n");
                    }
                }
                domWindow.addEventListener("load", loadhandler, false);

                // Add a ui-start handler to launch the casper tests.
                var handler = function(event) {
                    try {
                        domWindow.removeEventListener("komodo-ui-started", handler, false);
                        self.handleLoad(event);
                    } catch(e) {
                        dump(e+"\n");
                    }
                }
                domWindow.addEventListener("komodo-ui-started", handler, false);
            } catch(e) {
                dump(e+"\n");
            }
            break;
        }
    },
    
    forceQuit: function() {
        var appStartup = Components.classes["@mozilla.org/toolkit/app-startup;1"]
                                   .getService(Components.interfaces.nsIAppStartup);
        appStartup.quit(appStartup.eForceQuit);
    },

    handleLoad: function(event) {
        try {
            // target is document, currentTarget is the chromeWindow
            // is this a xul window?
            if (event.target.contentType != 'application/vnd.mozilla.xul+xml')
                return;
            var win = event.currentTarget;
            if ('Casper' in event.currentTarget) {
                if (this.params.length > 0) {
                    win.setTimeout(function(w, p, l, e) {
                                       w.Casper.UnitTest.runTestsText(p, l, e);
                                   }, 2000, win, this.params, this.logfile,
                                   this.eot);
                    this.params = [];
                } else {
                    // open the xul test window
                    win.setTimeout(win.Casper.UnitTest.runTestsXUL, 1000);
                }
            }
        } catch(e) {
            dump(e+"\n");
        }
    }
};

const clh_contractID = "@activestate.com/casper/casper-clh;1";
const clh_CID = Components.ID("{C37134CD-A4B0-11DA-BA30-000D935D3368}");
const clh_category = "c-casper";

const CasperConsoleHandlerModule = {
    /* nsISupports */

    QueryInterface : function mod_QI(iid) {
        if (iid.equals(nsIModule) ||
            iid.equals(nsISupports))
            return this;

        throw Components.results.NS_ERROR_NO_INTERFACE;
    },

    /* nsIModule */

    getClassObject : function mod_gch(compMgr, cid, iid) {
        if (cid.equals(clh_CID))
            return CasperConsoleHandler.QueryInterface(iid);

        throw Components.results.NS_ERROR_NOT_REGISTERED;
    },

    registerSelf : function mod_regself(compMgr, fileSpec, location, type) {
        compMgr.QueryInterface(nsIComponentRegistrar);

        compMgr.registerFactoryLocation(clh_CID,
                                        "CasperConsoleHandler",
                                        clh_contractID,
                                        fileSpec,
                                        location,
                                        type);

        var catMan = Components.classes["@mozilla.org/categorymanager;1"]
                               .getService(nsICategoryManager);
        catMan.addCategoryEntry("command-line-handler",
                                clh_category,
                                clh_contractID, true, true);
    },

    unregisterSelf : function mod_unreg(compMgr, location, type) {
        compMgr.QueryInterface(nsIComponentRegistrar);

        compMgr.unregisterFactoryLocation(clh_CID, location);

        var catMan = Components.classes["@mozilla.org/categorymanager;1"]
                               .getService(nsICategoryManager);
        catMan.deleteCategoryEntry("command-line-handler", clh_category);
    },

    canUnload : function (compMgr) {
        return true;
    }
};

/* module initialisation */
function NSGetModule(comMgr, fileSpec) {
    return CasperConsoleHandlerModule;
}
