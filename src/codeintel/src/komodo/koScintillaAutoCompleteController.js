/**
 * koAutoCompleteController
 * Autocomplete wrapper for the Komodo scintilla UI
 * @note This is tied deeply into the menupopup in scintilla.p.xml
 */

const Ci = Components.interfaces;
const Cc = Components.classes;
const Cr = Components.results;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");

XPCOMUtils.defineLazyGetter(Components.utils.getGlobalForObject({}), "log", function() {
  var {logging} = Components.utils.import("chrome://komodo/content/library/logging.js", {});
  var log = logging.getLogger("koScintillaAutoCompleteController");
  //log.setLevel(logging.LOG_DEBUG);
  return log;
});

function KoScintillaAutoCompleteController() {
  this.wrappedJSObject = this; // needed for init()
  this._scintilla_weak = null;
  this._popup_weak = null;
}

KoScintillaAutoCompleteController.prototype = {
  /**
   * Initialize the controller
   * @param aScintilla the <scintilla> to control
   * @param aPopup the panel with the widgets
   * @note this is triggered from <scintilla>
   */
  init: function KSACC_init(aScintilla, aPopup) {
    // weak reference to the scintilla element
    this._scintilla_weak = Components.utils.getWeakReference(aScintilla);
    // weak reference to the popup (with matching unprefix getter)
    this._popup_weak = Components.utils.getWeakReference(aPopup);
    // the search strings (for typeahead)
    this.__searchStrings = null;
    // the columns, objects of {type:Number, data:[String], maxLength:Number}
    this._columns = [];
    // the primary column (a reference into this._columns)
    this._primaryColumn = null;
    // whether <richlistitem>s have been built
    this._itemsConstructed = false;
    // whether we have sized the popup
    this._popupHasHeight = false;
    // the last selected item
    this._selectedItem = null;

    // this is a list of events the listener might find useful; that can do its
    // own filtering.
    for each (var eventName in ["keydown", "keypress", "keyup", "popupshowing",
                                "popupshown", "popuphiding", "popuphidden",
                                "focus", "blur", "DOMMouseScroll"])
    {
      this._popup.addEventListener(eventName, this, true);
    }

    this._scrollbar.addEventListener("mousemove", this, true);
  },

  reset: function KSACC_reset() {
    this.__searchStrings = null;
    this._columns = []; // drop all columns
    this._primaryColumn = null;
    this._itemsConstructed = false;
    this._popupHasHeight = false;
    this._selectedItem = null;
  },

  addColumn: function KSACC_addColumn(aColumnType, aStrings, aCount, aPrimary) {
    if (this._columns.length < 1) {
      // this is the first column
      this._scrollbar.setAttribute("maxpos", aCount);
    } else if (aStrings.length != this.itemCount) {
      // array length mismatch, we'll have problems showing things
      throw Components.Exception("addColumn: got " + aStrings.length + " items," +
                                 "expected " + this.itemCount,
                                 Components.results.NS_ERROR_INVALID_ARG);
    }
    var strings = Array.map(aStrings, function(s) s || "");
    var maxLength = Math.max.apply(null, strings.map(function(s) s.length));
    this._columns.push({type: aColumnType,
                        data: strings,
                        maxLength: maxLength});
    if (aPrimary) {
      this._primaryColumn = this._columns[this._columns.length - 1];
      // clear out the search strings, in case we built it from the first column
      this.__searchStrings = null;
    }
    // we need to rebuild the items to account for the new column
    this._itemsConstructed = false;
  },

  /**
   * Construct the template items if necessary
   */
  _constructItems: function KSACC__constructItems() {
    if (this._itemsConstructed) {
      // already done
      return;
    }

    while (this._grid.firstChild) {
      this._grid.removeChild(this._grid.firstChild);
    }

    // Try to figure out what the default font style is
    var fontString = "";
    var scimoz = this._scimoz;
    if (scimoz) {
      const STYLE_DEFAULT = Components.interfaces.ISciMoz.STYLE_DEFAULT;
      var buf = {};
      scimoz.styleGetFont(STYLE_DEFAULT, buf);
      fontString = scimoz.styleGetSize(STYLE_DEFAULT) + "pt " +
                   '"' + buf.value + '"';
    }

    var document = this._grid.ownerDocument;
    var columns = document.createElement("columns");
    for each (let column in this._columns) {
      let elem = document.createElement("column");
      var type = Object.keys(Ci.koIScintillaAutoCompleteController)
                       .filter(function(n) /^COLUMN_TYPE_/.test(n))
                       .filter(function(n) Ci.koIScintillaAutoCompleteController[n] == column.type);
      elem.setAttribute("type", type[0]);
      columns.appendChild(elem);
    }
    this._grid.appendChild(columns);
    var rows = document.createElement("rows");
    for (var i = 0; i < this._visibleCount; ++i) {
      var item = document.createElement("row");
      item.setAttribute("class", "ko-autocomplete-item");
      if (fontString) {
        // We have the scintilla default font style; use it.
        // (This is set on the row so that it's still possible to override the
        // font choice from CSS by being more specific.)
        item.style.font = fontString;
      }
      for each (var column in this._columns) {
        switch (column.type) {
          case Ci.koIScintillaAutoCompleteController.COLUMN_TYPE_TEXT: {
            let box = document.createElement("box");
            box.setAttribute("column-type", "text");
            let wrapper = document.createElement("text-wrapper");
            box.appendChild(wrapper);
            let label = document.createElement("description");
            label.style.width = column.maxLength + "ch";
            wrapper.appendChild(label);
            item.appendChild(box);
            break;
          }
          case Ci.koIScintillaAutoCompleteController.COLUMN_TYPE_IMAGE: {
            // create an extra <box> around the image so we don't accidentally
            // stretch the image
            let wrapper = document.createElement("box");
            wrapper.setAttribute("class", "image");
            wrapper.setAttribute("column-type", "image");
            let image = document.createElement("image");
            image.setAttribute("src", "");
            wrapper.appendChild(image);
            item.appendChild(wrapper);
            break;
          }
        }
      }
      rows.appendChild(item);
      item.addEventListener("click", (function(item, event) {
        this.selectedIndex = parseInt(item.getAttribute("index"), 10);
      }).bind(this, item), false);
      item.addEventListener("dblclick", (function(item, event) {
        this.selectedIndex = parseInt(item.getAttribute("index"), 10);
        this._fireEvent("command", event);
      }).bind(this, item), false);
    }
    this._grid.appendChild(rows);

    // at this point we have all the items, so we know if we need a scrollbar.
    this._scrollbar.collapsed = !(this.itemCount > this._visibleCount);

    this._popupHasHeight = false;
    this._itemsConstructed = true;
  },

  /**
   * Update the display of the visible items
   * @param aSelectedIndex [optional] the index to display as selected; if
   *        undefined, selection is not changed; if null, selection is removed.
   * @param aTopIndex [optional] The first item to show
   */
  _updateDisplay: function KASCC__updateDisplay(aSelectedIndex, aTopIndex) {
    this._constructItems();
    if (aSelectedIndex === null) {
      this._selectedItem = null;
      // set to NaN so the isNaN check below passes and we try to find a useful
      // selected index
      aSelectedIndex = NaN;
    }
    if (isNaN(aSelectedIndex)) {
      // no index given, try to use the current selected index
      if (this._selectedItem) {
        aSelectedIndex = parseInt(this._selectedItem.getAttribute("index"), 10);
      }
    }
    if (!isNaN(aSelectedIndex)) {
      aSelectedIndex = Math.min(aSelectedIndex, this.itemCount - 1);
      aSelectedIndex = Math.max(aSelectedIndex, 0);
    }
    if (isNaN(aTopIndex)) {
      // If we already have items visible, check if the selected index is
      // already visible
      let currentTop = this._firstVisibleIndex;
      if (isNaN(aSelectedIndex)) {
        // no selected index; show the current item, or the first item
        aTopIndex = currentTop;
      } else if (currentTop <= aSelectedIndex && currentTop + this._visibleCount > aSelectedIndex) {
        // No new top given, and the target item is already visible - just
        // select it without moving.
        aTopIndex = currentTop;
      } else {
        // The new selected item isn't visible; show it somewhere near the middle
        aTopIndex = Math.ceil(aSelectedIndex - this._visibleCount / 2);
      }
    }
    // make sure we don't go past the last item
    aTopIndex = Math.min(aTopIndex, this.itemCount - this._visibleCount);
    // make sure we don't go above the first item
    aTopIndex = Math.max(aTopIndex, 0);
    log.debug("_updateDisplay: selecting " + aSelectedIndex + " (top " + aTopIndex + ")");
    var rows = Array.slice(this._rows.childNodes);
    if (this._selectedItem) {
      this._selectedItem.removeAttribute("selected");
      this._selectedItem = null;
    }
    for (var i = 0; i < rows.length; ++i) {
      var row = rows[i];
      var index = aTopIndex + i;
      row.setAttribute("index", index);
      for (var colIndex = 0; colIndex < this._columns.length; ++colIndex) {
        var column = this._columns[colIndex];
        var elem = row.childNodes[colIndex];
        switch (column.type) {
          case Ci.koIScintillaAutoCompleteController.COLUMN_TYPE_TEXT:
            elem.querySelector("description").textContent = column.data[index];
            break;
          case Ci.koIScintillaAutoCompleteController.COLUMN_TYPE_IMAGE:
            elem.querySelector("image").setAttribute("src", column.data[index]);
            break;
        }
      }
      if (index === aSelectedIndex) {
        row.setAttribute("selected", "true");
        this._selectedItem = row;
      } else {
        row.removeAttribute("selected");
      }
    }
    if (isNaN(aSelectedIndex)) {
      this._scrollbar.setAttribute("curpos", aTopIndex + Math.floor(this._visibleCount / 2));
    } else {
      this._scrollbar.setAttribute("curpos", aSelectedIndex);
    }
  },

  show: function KASCC_show(aStartPos, aEndPos, aAnchorPos, aPrefix) {
    aPrefix = aPrefix ? aPrefix.toLowerCase() : "";

    var scintilla = this._scintilla;
    if (!scintilla) {
      throw Components.Exception("<scintilla> went away for this autocomplete controller",
                                 Cr.NS_ERROR_NOT_AVAILABLE);
    }

    /**
     * Construct a rectangle
     * @param props {Object} Hash with left/top/width/height properties
     * @note Rectangles also support bottom/right properties, but not for
     *       construction.
     */
    function Rect(props) {
      this.left = props.screenX || props.left;
      this.top = props.screenY || props.top;
      this.width = props.width; this.height = props.height;
      Object.defineProperty(this, "bottom", {
        get: function() this.top + this.height,
        set: function(v) this.height = v - this.top });
      Object.defineProperty(this, "right", {
        get: function() this.left + this.width,
        set: function(v) this.width = v - this.left });
      this.toString = function()
        "(" + this.left.toFixed(0) + ", " + this.top.toFixed(0) + ")-" +
        "(" + this.right.toFixed(0) + ", " + this.bottom.toFixed(0) + ")+" +
        "(" + this.width.toFixed(0) + ", " + this.height.toFixed(0) + ")";
    }

    /**
     * Get the pixel coordinates (in CSS pixels relative to the <scimoz>
     * element) for a given scintilla position
     * @param aPos {Number} The scintilla position
     * @param aBelow {Boolean} If true, return the coordinates for the point
     *        at the bottom left of the rectangle for the line; otherwise,
     *        return the top-left corner.
     * @returns {Rect} Pixel coordinates of the position
     */
    function getPointAtPosition(aPos, aBelow) {
      var left = scintilla.scimoz.pointXFromPosition(aPos);
      var top = scintilla.scimoz.pointYFromPosition(aPos);
      if (aBelow) {
        log.debug("getPointAtPosition: " + aBelow + ", from " + left + "," + top);
        top += scintilla.scimoz.textHeight(scintilla.scimoz.lineFromPosition(aPos));
        log.debug(" to " + left + "," + top);
      }
      return new Rect({left: left, top: top, width: 0, height: 0});
    }

    /**
     * Adjust aTargetBounds horizontally so that it fits in aScreenBounds
     * @param aTargetBounds bounds for the target
     * @param aScreenBounds bounds for the screen
     * @returns adjusted bounds, or null if it won't usefully fit
     */
    function adjustBounds(aTargetBounds, aScreenBounds) {
      log.debug("adjustBounds: target=" + aTargetBounds + " / screen = " + aScreenBounds);
      if (aTargetBounds.top < aScreenBounds.top) return null;
      if (aTargetBounds.bottom > aScreenBounds.bottom) return null;
      var bounds = new Rect(aTargetBounds);
      if (bounds.left < aScreenBounds.left) {
        // too far to the left, move it towards the right
        bounds.left = aScreenBounds.left;
      }
      if (bounds.right > aScreenBounds.right) {
        // too far to the right, move it to the left
        bounds.left = aScreenBounds.right - bounds.width;
      }
      if (bounds.left < aScreenBounds.left) {
        // just can't fit both left and right
        return null;
      }
      log.debug("adjustBounds: success " + bounds);
      return bounds;
    }

    var scintillaRect = new Rect(scintilla.boxObject);
    var window = scintilla.ownerDocument.defaultView;
    var sm = Cc["@mozilla.org/gfx/screenmanager;1"]
               .getService(Ci.nsIScreenManager)
    var screen = sm.screenForRect(scintillaRect.left,
                                  scintillaRect.top,
                                  scintillaRect.width,
                                  scintillaRect.height);
    var screenRect = { left: {}, top: {}, width: {}, height: {}};
    screen.GetAvailRect(screenRect.left, screenRect.top, screenRect.width, screenRect.height);
    log.debug('screenRect: ' + JSON.stringify(screenRect));
    screenRect = new Rect({left: screenRect.left.value, top: screenRect.top.value,
                           width: screenRect.width.value,
                           height: screenRect.height.value});

    this._constructItems(); // construct items if necessary

    if (!this._popupHasHeight) {
      // popup hasn't been shown since the data changed
      this._updateDisplay();
      this._popupHasHeight = true;
    }

    /* Position the popup. We want to try, in order:
     *   1. Just below the anchor position (shifted horizontally if needed),
     *      as long as this doesn't cover up the start pos...end pos range
     *   2. Just above the anchor position (shifted horizontally if needed),
     *      as long as this doesn't cover up the start pos...end pos range
     *   3. Steps 1 and 2 for end pos instead of anchor pos
     *   4. Steps 1 and 2 for start pos instead of anchor pos
     *   5. Give up and show it anywhere
     */
    var foundPosition = false;
    for each (var anchor in [aAnchorPos, aEndPos, aStartPos]) {
      var popupRect = new Rect(this._popup.getBoundingClientRect());

      // prefer showing below the anchor
      var anchorPos = getPointAtPosition(anchor, true);
      var targetBounds = new Rect({
        left: scintillaRect.left + anchorPos.left,
        top: scintillaRect.top + anchorPos.top,
        width: popupRect.width, height: popupRect.height
      });
      targetBounds = adjustBounds(targetBounds, screenRect);
      if (targetBounds) {
        this._popup.openPopupAtScreen(targetBounds.left, targetBounds.top, false);
        break;
      }
      // try above it
      anchorPos = getPointAtPosition(aAnchorPos, false);
      targetBounds = new Rect({
        left: scintillaRect.left + anchorPos.left,
        top: scintillaRect.top + anchorPos.top - popupRect.height,
        width: popupRect.width, height: popupRect.height
      });
      targetBounds = adjustBounds(targetBounds, screenRect);
      if (targetBounds) {
        this._popup.openPopupAtScreen(targetBounds.left, targetBounds.top, false);
        foundPosition = true;
        break;
      }
    }
    if (!foundPosition) {
      // didn't manage to find somewhere sensible; pick anywhere
      let anchorPos = getPointAtPosition(aAnchorPos, true);
      this._popup.openPopupAtScreen(anchorPos.left, anchorPos.top, false);
    }

    if (aPrefix) {
      log.debug("prefix: " + aPrefix);
      let index, string, found = false;
      if (this._selectedItem) {
        // first, see if the currently selected item matches
        index = parseInt(this._selectedItem.getAttribute("index"), 10);
        string = this._selectedItem[index] || "";
        if (aPrefix === string.substr(0, aPrefix.length)) {
          // the currently selected item is fine
          found = true;
        }
      }
      if (!found) {
        // the currently selected item is no good; try to find anything
        for (index = 0; index < this.itemCount; ++index) {
          if (aPrefix == this._searchStrings[index].substr(0, aPrefix.length)) {
            this.selectedIndex = index;
            found = true;
            break;
          }
        }
      }
      if (!found) {
        // can't find the prefix; don't select anything
        this._updateDisplay(null);
      }
    } else {
      // don't select anything
      this._updateDisplay(null);
    }
    this._grid.controllers.appendController(this);
    this._popup.ownerDocument.commandDispatcher.focusedElement = this._grid;
  },

  close: function KASCC_close() {
    this._popup.hidePopup();
    try {
      this._grid.controllers.removeController(this);
    } catch (e) {
      // This happens if we never got far enough to add the controller (i.e. we
      // decided to force close before the popup managed to _actually_ show up).
      // That's fine to ignore, though of course it would be better if it didn't
      // throw...
    }
  },

  applyCompletion: function KASCC_applyCompletion(aStartPos, aEndPos, aCompletion) {
    var scimoz = this._scimoz;
    if (!scimoz) {
      throw Components.Exception("applyCompletion: failed to get scintilla",
                                 Components.results.NS_ERROR_UNEXPECTED);
    }
    if (aCompletion === null) {
      // compare against null to check for argument not given (as opposed to "")
      aCompletion = this.selectedText;
    }
    if (aCompletion === null) {
      // no completion given, _and_ we have nothing selected. Just close.
      this.close();
      return;
    }
    if (aStartPos < 0) {
      throw Components.Exception("applyCompletion: start position must not be " +
                                 "negative; found " + aStartPos);
    }
    if (aEndPos < 0) {
      aEndPos = scimoz.currentPos;
    }
    if (aEndPos < aStartPos) {
      throw Components.Exception("applyCompletion: start position " + aStartPos +
                                 " is after end position " + aEndPos);
    }
    scimoz.setSel(aStartPos, aEndPos);
    scimoz.replaceSel(aCompletion);
    this.close();
    // We have to colourise the line in order to get a
    // trigger - lang_css requires CSS styling, which
    // hasn't occurred yet for the inserted text.
    var lineno = scimoz.lineFromPosition(aStartPos);
    var lineStartPos = scimoz.positionFromLine(lineno);
    lineno = scimoz.lineFromPosition(aEndPos);
    var lineEndPos = scimoz.getLineEndPosition(lineno);
    scimoz.colourise(lineStartPos, lineEndPos);
    // Give colourise some time to finish, then retrigger codeintel.
    Services.tm.currentThread.dispatch(this._fireEvent.bind(this, "completion"),
                                       Ci.nsIThread.DISPATCH_NORMAL);
    // Dispatch the "codeintel_autocomplete_selected" event at scintilla; this
    // needs to bubble, and needs to contain extra data, so _fireEvent() can't
    // be used here.
    var scintilla = this._scintilla;
    var event = scintilla.ownerDocument.createEvent("DataContainerEvent");
    event.initEvent("codeintel_autocomplete_selected", true, true);
    event.setData("position", aStartPos);
    event.setData("text", aCompletion);
    scintilla.dispatchEvent(event);
  },

  getTextAt: function KASCC_getTextAt(aIndex) {
    if (!(aIndex >= 0 && aIndex < this.itemCount)) {
      throw Components.Exception("getTextAt: invalid index " + aIndex,
                                 Components.results.NS_ERROR_INVALID_ARG);
    }
    if (!this._primaryColumn) {
      throw Components.Exception("getTextAt: no primary column set",
                                 Components.results.NS_ERROR_UNEXPECTED);
    }
    if (!(aIndex in this._primaryColumn.data)) {
      return null;
    }
    return this._primaryColumn.data[aIndex];
  },

  get itemCount()
    this._columns.length > 0 ? this._columns[0].data.length : undefined,

  get selectedIndex() {
    if (this._popup.state !== "open") return -1;
    if (!this._itemsConstructed) return -1;
    if (!this._selectedItem) return -1;
    return parseInt(this._selectedItem.getAttribute("index"), 10);
  },

  set selectedIndex(val) {
    log.debug("setting selected index to " + val);
    if (["open", "showing"].indexOf(this._popup.state) == -1) {
      log.debug("popup not open @" + this._popup.state);
      return -1;
    }
    this._updateDisplay(val);
    return this.selectedIndex;
  },

  get selectedText()
    this.selectedIndex < 0 ? null : this.getTextAt(this.selectedIndex),

  get active()
    this._popup.state === "open",

  /**
   * helpers
   */
  get _scrollbar() this._popup.firstChild.lastChild,

  get _grid() this._popup.firstChild.firstChild,

  get _rows() this._grid.querySelector("rows"),

  get _popup() this._popup_weak.get(),

  get _scintilla() this._scintilla_weak.get(),

  get _scimoz() (this._scintilla || {scimoz: null}).scimoz,

  /**
   * The primary column; if not specified, use the first text column
   */
  get _primaryColumn() {
    if (this.__primaryColumn) {
      return this.__primaryColumn;
    }
    for each (var column in this._columns) {
      if (column.type === Ci.koIScintillaAutoCompleteController.COLUMN_TYPE_TEXT) {
        return column;
      }
    }
    return undefined;
  },
  set _primaryColumn(val) {
    if (val && val.type !== Ci.koIScintillaAutoCompleteController.COLUMN_TYPE_TEXT) {
      throw Components.Exception("Cannot set primary column to " +
                                 JSON.stringify(val) +
                                 ", its type is not text");
    }
    return this.__primaryColumn = val;
  },

  /**
   * The search strings; this is used for type-ahead selection (typing into the
   * list to select an item).  It is forced lower case because we want case-
   * insensitive searching.
   */
  get _searchStrings() {
    if (this.__searchStrings === null) {
      // not set; need to generate it
      this.__searchStrings = this._primaryColumn.data.map(String.toLowerCase);
    }
    return this.__searchStrings;
  },

  /**
   * Autocomplete-specific preferences
   */
  get _prefs() {
    if (!("__prefs" in this)) {
      var prefsvc = Cc["@activestate.com/koPrefService;1"]
                      .getService(Ci.koIPrefService).effectivePrefs;
      if (prefsvc.hasPref("autocomplete")) {
        this.__prefs = prefsvc.getPref("autocomplete");
      } else {
        this.__prefs = Cc["@activestate.com/koPreferenceSet;1"]
                         .createInstance(Ci.koIPreferenceSet);
        prefsvc.setPref("autocomplete", this.__prefs);
      }
    }
    return this.__prefs;
  },

  /**
   * The number of items to display
   * (This depends on the number of items available)
   */
  get _visibleCount()
    // minimum of 2, otherwise we can't show the scrollbar correctly
    Math.min(this._prefs.hasLongPref("maxHeight") ?
               Math.max(2, this._prefs.getLongPref("maxHeight")) : 5,
             this.itemCount),

  /**
   * The index of the first visible item; Number.NEGATIVE_INFINITY if there
   * are no valid items visible
   */
  get _firstVisibleIndex() {
    var firstVisible = this._rows.firstChild;
    if (!firstVisible || !firstVisible.hasAttribute("index")) {
      return Number.NEGATIVE_INFINITY;
    }
    return parseInt(firstVisible.getAttribute("index"), 10);
  },

  /**
   * Fire a DOM event at any listeners
   * @param name {String} The name of the event (i.e. event.type)
   * @param baseEvent {Event} [optional] The event that triggered this one
   */
  _fireEvent: function KASCC__fireEvent(name, baseEvent) {
    if (this.listener) {
      var document = this._popup.ownerDocument;
      var newEvent = document.createEvent("XULCommandEvent")
                             .QueryInterface(Ci.nsIDOMXULCommandEvent);
      var view = baseEvent ? baseEvent.view : this._popup.ownerDocument.defaultView;
      newEvent.initCommandEvent(name, true, true, view, 0,
                                baseEvent ? baseEvent.ctrlKey : false,
                                baseEvent ? baseEvent.altKey : false,
                                baseEvent ? baseEvent.shiftKey : false,
                                baseEvent ? baseEvent.metaKey : false,
                                baseEvent || null);
      this.listener.onAutoCompleteEvent(this, newEvent);
    }
  },

  /**
   * nsIDOMEventListener
   */
  handleEvent: function KASCC_handleEvent(event) {
    log.debug("event: " + event.type);
    specific_handler:
    switch (event.type) {
      case "popuphidden":
        var scintilla = this._scintilla;
        if (scintilla) {
          scintilla.focus();
        }
        break;
      case "keypress":
        // for these keys, we want to navigate within the listbox, instead
        // of within the editor; so we stop this from getting to the
        // scintilla, as well as not telling listeners about it (so that
        // it does not close the popup).
        switch(event.keyCode) {
          case Ci.nsIDOMKeyEvent.DOM_VK_UP: {
            if (this._selectedItem) {
              // something is selected, select the one before that
              let top = Math.min(this._firstVisibleIndex,
                                 this.selectedIndex - 1);
              this._updateDisplay(this.selectedIndex - 1, top);
            } else {
              // select the last visible item
              this._updateDisplay(this._firstVisibleIndex + this._visibleCount - 1);
            }
            break;
          }
          case Ci.nsIDOMKeyEvent.DOM_VK_DOWN: {
            if (this._selectedItem) {
              // something is selected, select the one after that
              let top = Math.max(this._firstVisibleIndex,
                                 this.selectedIndex - this._visibleCount + 2);
              this._updateDisplay(this.selectedIndex + 1, top);
            } else {
              // select the first visible item
              this._updateDisplay(this._firstVisibleIndex);
            }
            break;
          }
          case Ci.nsIDOMKeyEvent.DOM_VK_PAGE_UP: {
            if (this._selectedItem) {
              // select one page before the currently selected item
              this._updateDisplay(this.selectedIndex - this._visibleCount);
            } else {
              // just scroll up
              this._updateDisplay(null, this._firstVisibleIndex - this._visibleCount);
            }
            break;
          }
          case Ci.nsIDOMKeyEvent.DOM_VK_PAGE_DOWN: {
            if (this._selectedItem) {
              // select one page after the currently selected item
              this._updateDisplay(this.selectedIndex + this._visibleCount);
            } else {
              // just scroll down
              this._updateDisplay(null, this._firstVisibleIndex + this._visibleCount);
            }
            break;
          }
          case Ci.nsIDOMKeyEvent.DOM_VK_HOME: {
            this._updateDisplay(Number.NEGATIVE_INFINITY);
            break;
          }
          case Ci.nsIDOMKeyEvent.DOM_VK_END: {
            this._updateDisplay(Number.POSITIVE_INFINITY);
            break;
          }
          default:
            break specific_handler;
        }
        event.stopPropagation();
        event.preventDefault();
        return;
      case "DOMMouseScroll":
        if (event.axis == event.VERTICAL_AXIS) {
          var curPos = parseInt(this._scrollbar.getAttribute("curpos"), 10);
          this._updateDisplay(curPos + event.detail);
          event.stopPropagation();
          event.preventDefault();
        }
        return;
    }
    if (event.target == this._scrollbar) {
      // scrollbar events - just update the scroll position
      this._updateDisplay(parseInt(this._scrollbar.getAttribute("curpos"), 10));
      return;
    }
    if (this.listener) {
      this.listener.onAutoCompleteEvent(this, event);
    }
  },

  /**
   * nsIController
   */
  isCommandEnabled: function KASCC_isCommandEnabled(command) {
    var scintilla = this._scintilla;
    if (!scintilla) return false;
    var controller = scintilla.controllers.getControllerForCommand(command);
    if (!controller) return false;
    return controller.isCommandEnabled(command);
  },
  supportsCommand: function KASCC_supportsCommand(command) {
    var scintilla = this._scintilla;
    if (!scintilla) return false;
    var controller = scintilla.controllers.getControllerForCommand(command);
    if (!controller) return false;
    return controller.supportsCommand(command);
  },
  doCommand: function KASCC_doCommand(command) {
    var scintilla = this._scintilla;
    if (!scintilla) return;
    var controller = scintilla.controllers.getControllerForCommand(command);
    if (!controller) return;
    controller.doCommand(command);
  },
  onEvent: function KASCC_onEvent(eventName) {
    var scintilla = this._scintilla;
    if (!scintilla) return;
    for (var i = 0; i < scintilla.controllers.getControllerCount(); ++i) {
      scintilla.controllers.getControllerAt(i).onEvent(eventName);
    }
  },

  /**
   * XPCOM goop
   */
  QueryInterface: XPCOMUtils.generateQI([Ci.koIScintillaAutoCompleteController,
                                         Ci.nsIDOMEventListener,
                                         Ci.nsIController,
                                         Ci.nsISupportsWeakReference]),
  classID: Components.ID("{88febdcd-e6f0-4542-9d16-464413967757}"),
  __proto__: KoScintillaAutoCompleteController.prototype,
}

const NSGetFactory =
  XPCOMUtils.generateNSGetFactory([KoScintillaAutoCompleteController]);