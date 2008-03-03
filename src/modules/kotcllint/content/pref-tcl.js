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

//---- globals
var _findingInterps = false;
var dialog;
var wishExecutable = null;
var tclExecutable = null;
var log = ko.logging.getLogger('prefs.tcl');

//---- functions

function PrefTcl_OnLoad()
{
    try {
        dialog = {};
        // This ensures all of our preferences get loaded correctly.
        var tclInfoEx = Components.classes["@activestate.com/koAppInfoEx?app=Tcl;1"]
                         .createInstance(Components.interfaces.koITclInfoEx);

        if (parent.hPrefWindow.prefset.hasStringPref('tclshDefaultInterpreter') &&
            parent.hPrefWindow.prefset.getStringPref('tclshDefaultInterpreter')) {
            tclExecutable = parent.hPrefWindow.prefset.getStringPref('tclshDefaultInterpreter');
        } else {
            tclExecutable = '';
            parent.hPrefWindow.prefset.setStringPref('tclshDefaultInterpreter', '');
        }

        if (parent.hPrefWindow.prefset.hasStringPref('wishDefaultInterpreter') &&
            parent.hPrefWindow.prefset.getStringPref('wishDefaultInterpreter')) {
            wishExecutable = parent.hPrefWindow.prefset.getStringPref('wishDefaultInterpreter');
        } else {
            wishExecutable = '';
            parent.hPrefWindow.prefset.setStringPref('wishDefaultInterpreter', '');
        }

        if (!parent.hPrefWindow.prefset.hasStringPref('tclExtraPaths')) {
            parent.hPrefWindow.prefset.setStringPref('tclExtraPaths', '');
        }

        _findingInterps = true;
        PrefTcl_InsertFindingMessage(document.getElementById("wishDefaultInterpreter"));
        PrefTcl_InsertFindingMessage(document.getElementById("tclshDefaultInterpreter"));
        PrefTcl_PopulateTclInterps();

        var origWindow = ko.windowManager.getMainWindow();
        var cwd = origWindow.ko.window.getCwd();
        parent.hPrefWindow.onpageload();
        var extraPaths = document.getElementById("tclExtraPaths");
        extraPaths.setCwd(cwd)
        extraPaths.init() // must happen after onpageload
    } catch (e) {
        log.exception(e);
    }
}


function OnPreferencePageOK(prefset)
{
    var ok = true;

    // ensure that the default tcl interpreters are valid
    var defaultTclshInterp = prefset.getStringPref("tclshDefaultInterpreter");
    var defaultWishInterp  = prefset.getStringPref("wishDefaultInterpreter");
    var koSysUtils = Components.classes["@activestate.com/koSysUtils;1"].
        getService(Components.interfaces.koISysUtils);

    if (defaultTclshInterp != "") {
        if (! koSysUtils.IsFile(defaultTclshInterp)) {
            alert("No Tcl interpreter could be found at '" +
                  defaultTclshInterp + "'. You must make another " +
                  "selection for the default Tcl interpreter.\n");
            ok = false;
            document.getElementById("tclshDefaultInterpreter").focus();
        }
    }

    if (defaultWishInterp != "") {
        if (! koSysUtils.IsFile(defaultWishInterp)) {
            alert("No Tcl Wish interpreter could be found at '" +
                  defaultWishInterp + "'. You must make another selection " +
                  "for the default Tcl Wish interpreter.\n");
            ok = false;
            document.getElementById("wishDefaultInterpreter").focus();
        }
    }

    return ok;
}

function PrefTcl_PopulateTclInterps()
{
    // Populate the (tree) list of available Tcl interpreters on the current
    // system.

    var tclInfoEx = Components.classes["@activestate.com/koAppInfoEx?app=Tcl;1"]
                     .createInstance(Components.interfaces.koITclInfoEx);

    var os = Components.classes["@activestate.com/koOs;1"]
                     .createInstance(Components.interfaces.koIOs);

    var numFound = new Object();
    var availInterps = tclInfoEx.FindInstallationPaths(numFound);
    var licensedTclsh = Array();
    var licensedWish = Array();
    var unlicensedInstalls = Array();

    for (var i = 0; i < availInterps.length; ++i){
        tclInfoEx.installationPath = availInterps[i]
        if (tclInfoEx.tclsh_path && os.path.exists(tclInfoEx.tclsh_path)) {
            licensedTclsh.push(tclInfoEx.tclsh_path)
        }
        if (tclInfoEx.wish_path && os.path.exists(tclInfoEx.wish_path)) {
            licensedWish.push(tclInfoEx.wish_path)
        }
    }

    PrefTcl_PopulateTclshInterps(licensedTclsh);
    PrefTcl_PopulateWishInterps(licensedWish);

    _findingInterps = false;
}

function PrefTcl_InsertFindingMessage(availInterpList)
{
    // remove any existing items and add a "finding..." one
    availInterpList.removeAllItems();
    availInterpList.appendItem("Finding available Tcl interpreters...");
}

function PrefTcl_PopulateTclshInterps(availInterps)
{
    var availInterpList = document.getElementById("tclshDefaultInterpreter");

    availInterpList.removeAllItems();
    availInterpList.appendItem("Find on Path",'');

    var found = false;
    // populate the tree listing them
    if (availInterps.length == 0) {
        // tell the user no interpreter was found and direct them to
        // ActiveState to get one
        document.getElementById("no-avail-tclsh-interps-message").removeAttribute("collapsed");
    } else {
        for (var i = 0; i < availInterps.length; i++) {
            availInterpList.appendItem(availInterps[i],availInterps[i]);
            if (availInterps[i] == tclExecutable) found = true;
        }
    }
    if (!found && tclExecutable)
        availInterpList.appendItem(tclExecutable,tclExecutable);
}

// Populate the (tree) list of available Tcl wish interpreters on the current
// system.
function PrefTcl_PopulateWishInterps(availInterps)
{
    var availInterpList = document.getElementById("wishDefaultInterpreter");

    availInterpList.removeAllItems();
    availInterpList.appendItem("Find on Path",'');

    var found = false;
    // populate the tree listing them
    if (availInterps.length == 0) {
        // tell the user no interpreter was found and direct them to
        // ActiveState to get one
        document.getElementById("no-avail-wish-interps-message").removeAttribute("collapsed");
    } else {
        for (var i = 0; i < availInterps.length; i++) {
            availInterpList.appendItem(availInterps[i],availInterps[i]);
            if (availInterps[i] == wishExecutable) found = true;
        }
    }
    if (!found && wishExecutable)
        availInterpList.appendItem(wishExecutable,wishExecutable);
}

function loadTclExecutable()
{
    var tclExe = ko.filepicker.openExeFile();
    if (tclExe != null) {
        var availInterpList = document.getElementById("tclshDefaultInterpreter");
        availInterpList.selectedItem = availInterpList.appendItem(tclExe, tclExe);
    }
}

function loadWishExecutable()
{
    var wishExe = ko.filepicker.openExeFile();
    if (wishExe != null) {
        var availInterpList = document.getElementById("wishDefaultInterpreter");
        availInterpList.selectedItem = availInterpList.appendItem(wishExe, wishExe);
    }
}
